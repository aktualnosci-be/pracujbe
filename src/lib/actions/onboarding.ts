'use server';

import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import {
  getPortalIdentity,
  isPortalDataConfigured,
  withPortalTransaction,
  withServiceRole,
} from '@/lib/db/portal';
import { execute, jsonArg, rpc } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import { consentWordingVersions } from '@/lib/signup-consents';
import type { Locale } from '@/i18n/routing';
import {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6DraftSchema,
  step6Schema,
} from '@/lib/validation/candidate';

/**
 * Server Actions onboardingu kandydata — realny zapis kroków profilu do bazy.
 *
 * Każdy krok jest walidowany odpowiednim `stepNSchema` (to samo źródło prawdy, co po stronie
 * klienta) i zapisywany w JEDNEJ transakcji sesji (`withPortalTransaction`, RLS jako kandydat,
 * #25) — błąd nie zostawia części kroku (#142):
 *   - krok 1 → `profiles` (first_name / last_name / phone; dane tożsamości są w profiles),
 *   - krok 3 → RPC `save_candidate_onboarding_step3` (0082): doświadczenie + umiejętności,
 *   - krok 5 → RPC `save_candidate_onboarding_step5` (0082): języki (z poziomem) + certyfikaty,
 *   - kroki 2, 4, 6 → `candidate_profiles` (UPSERT po unikalnym `profile_id`),
 *   - krok 6 z `finish: true` („Zakończ”) wymaga zgody, woła `finish_onboarding` i zapisuje
 *     receipty regulaminu i informacji o prywatności (`record_signup_consents`, 0108); bez `finish`
 *     („Zapisz i wyjdź”, #337) zapisuje dane kroku bez zgody i bez kończenia onboardingu.
 *     Atomowy jest tu sam zapis danych kroku; `finish_onboarding` to osobna transakcja, która tylko
 *     sprawdza kompletność — dane kroku 6 zostają zapisane także przy `ONBOARDING_INCOMPLETE`
 *     (jak przy „Zapisz i wyjdź”), a receipt jest best-effort.
 *
 * Relacje (skills/languages/certificates) zapisują SECURITY DEFINER RPC (replace-all, limity
 * i normalizacja z `set_candidate_*`, 0028/0079) — koniec cichej utraty danych z FUN-04.
 * Bezpośredni DML na tych tabelach jest odebrany klientowi (0028), więc RPC to jedyna ścieżka zapisu.
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy baza nie jest skonfigurowana,
 * walidujemy dane, ale NIE zapisujemy — zwracamy `{ ok: true, demo: true }`. Dzięki temu
 * build i UX działają bez backendu.
 * Bez technikaliów dla użytkownika (Invariant #8) — błędy mapujemy na kod użytkowy.
 */

export type OnboardingStep = 1 | 2 | 3 | 4 | 5 | 6;

export type SaveOnboardingResult =
  | { ok: true; demo?: boolean }
  | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('JWT') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/** Puste/whitespace → null (kolumny nullable w DB); w innym wypadku przycięta wartość. */
function nullIfEmpty(value: string | undefined): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Zapisuje pojedynczy krok onboardingu.
 *
 * @param step numer kroku (1..6)
 * @param data surowe dane kroku (walidowane `stepNSchema`)
 * @param options.finish tylko krok 6: zakończenie onboardingu (wymaga zgody)
 */
export async function saveOnboardingStep(
  step: OnboardingStep,
  data: unknown,
  options: { finish?: boolean } = {},
): Promise<SaveOnboardingResult> {
  const finish = step === 6 && options.finish === true;
  // 1) Walidacja odpowiednim schematem kroku (identyczna jak na kliencie).
  const parsed = validateStep(step, data, finish);
  if (!parsed.ok) return { ok: false, error: 'VALIDATION_FAILED' };

  // 2) Tryb demo (brak env) — nie zapisujemy, ale przepływ działa.
  if (!isPortalDataConfigured()) {
    return { ok: true, demo: true };
  }

  try {
    // 3) Autoryzacja — potrzebny zalogowany użytkownik (tożsamość z sesji serwera).
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    // 4) Zapis w zależności od kroku — jedna transakcja na krok.
    await withPortalTransaction(me, async (tx) => {
      if (step === 1) {
        const v = parsed.value as import('@/lib/validation/candidate').CandidateStep1;
        await execute(tx, 'onboarding.step1-profile',
          'UPDATE public.profiles SET first_name = $2, last_name = $3, phone = $4 WHERE id = $1',
          [me.id, v.firstName, v.lastName, nullIfEmpty(v.phone)]);
        return;
      }

      if (step === 3) {
        // Doświadczenie + umiejętności w jednej transakcji (0082) — błąd umiejętności cofa też
        // doświadczenie, więc komunikat błędu odpowiada stanowi bazy (#142).
        const v = parsed.value as import('@/lib/validation/candidate').CandidateStep3;
        await rpc(tx, 'save_candidate_onboarding_step3', {
          p_experience_years: v.experienceYears,
          p_skills: v.skills,
        });
        return;
      }

      if (step === 5) {
        // Języki (z poziomem) + certyfikaty w jednej transakcji (0082, #142).
        const v = parsed.value as import('@/lib/validation/candidate').CandidateStep5;
        await rpc(tx, 'save_candidate_onboarding_step5', {
          p_languages: jsonArg(v.languages.map((l) => ({ language: l.language, level: l.level }))),
          // Certyfikat z datą ważności (#96) — matching pomija wygasłe; brak daty = bezterminowy.
          p_certificates: jsonArg(v.certificates.map((label) => ({
            label,
            expires_at: v.certificateExpiry[label] ?? null,
          }))),
        });
        return;
      }

      // Kroki 2/4/6 → UPSERT do candidate_profiles po unikalnym profile_id (tylko kolumny kroku).
      await upsertCandidateProfile(tx, me.id, buildCandidateProfileRow(step, parsed.value, data));
    });

    if (finish) {
      // Kompletność liczy DB z obecności wymaganych danych (FUN-05) — klient nie może już
      // sam ustawić profile_completed (kolumna odebrana; RPC definer waliduje i ustawia).
      // Osobna transakcja: dane kroku 6 zostają zapisane także przy ONBOARDING_INCOMPLETE.
      const complete = await withPortalTransaction(me, (tx) => rpc(tx, 'finish_onboarding'));
      // P1-07: NIE zgłaszaj sukcesu, gdy baza uznała profil za niekompletny — inaczej kreator
      // przekierowuje, a profil pozostaje niewyszukiwalny bez żadnego komunikatu (pozorna awaria).
      if (complete !== true) return { ok: false, error: 'ONBOARDING_INCOMPLETE' };
      await recordTermsAcceptance(me.id);
    }
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    // Nieoczekiwany błąd — bez technikaliów dla użytkownika (Invariant #8).
    captureError(error, { area: 'onboarding.saveOnboardingStep' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Kolumny `candidate_profiles`, które kreator może zapisać (stała lista — nazwy trafiają do SQL). */
const CANDIDATE_PROFILE_COLUMNS: ReadonlySet<string> = new Set([
  'occupations',
  'categories',
  'city',
  'region',
  'radius_km',
  'has_driving_license',
  'has_car',
  'availability',
  'preferred_contract_types',
  'expected_salary_min',
  'expected_salary_currency',
  'bio',
]);

/**
 * `INSERT … ON CONFLICT (profile_id) DO UPDATE` wyłącznie kolumn danego kroku (jak dotychczasowy
 * upsert): nowy profil dostaje wartości domyślne pozostałych kolumn, istniejący — bez zmian w nich.
 */
async function upsertCandidateProfile(
  tx: TransactionQuery,
  profileId: string,
  row: Record<string, unknown>,
): Promise<void> {
  const columns = Object.keys(row);
  if (columns.length === 0 || columns.some((column) => !CANDIDATE_PROFILE_COLUMNS.has(column))) {
    throw new Error('Nieprawidłowe kolumny profilu kandydata.');
  }
  const placeholders = columns.map((_, index) => `$${index + 2}`);
  await execute(tx, 'onboarding.candidate-profile-upsert',
    `INSERT INTO public.candidate_profiles (profile_id, ${columns.join(', ')})
     VALUES ($1, ${placeholders.join(', ')})
     ON CONFLICT (profile_id) DO UPDATE SET ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(', ')}`,
    [profileId, ...columns.map((column) => row[column])]);
}

/** Waliduje dane kroku właściwym schematem; zwraca sparsowaną wartość albo błąd. */
function validateStep(
  step: OnboardingStep,
  data: unknown,
  finish: boolean,
): { ok: true; value: unknown } | { ok: false } {
  const schema = {
    1: step1Schema,
    2: step2Schema,
    3: step3Schema,
    4: step4Schema,
    5: step5Schema,
    6: finish ? step6Schema : step6DraftSchema,
  }[step];
  const result = schema.safeParse(data);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

/**
 * Niezmienne receipty z kroku 6 (#337, #493): akceptacja regulaminu i potwierdzenie
 * zapoznania się z informacją o prywatności jako OSOBNE wiersze (kanał `onboarding`).
 * Krok 6 nie pokazuje zgód opcjonalnych, więc nie powstaje żaden dowód zgody na inne cele.
 * Kluczowane po zweryfikowanym UUID z sesji (RPC tylko service_role → `withServiceRole`). Best-effort jak
 * dotąd: awaria receiptu nie cofa zapisanego profilu, ale trafia do kanału błędów (rozliczalność).
 */
async function recordTermsAcceptance(profileId: string): Promise<void> {
  try {
    const store = await headers();
    const ip =
      store.get('x-real-ip')?.trim() ||
      store.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ||
      null;
    const locale = (await getLocale()) as Locale;
    await withServiceRole((tx) => rpc(tx, 'record_signup_consents', {
      p_profile_id: profileId,
      p_terms_accepted: true,
      p_privacy_notice_ack: true,
      p_optional: jsonArg({}),
      p_source: 'onboarding',
      p_locale: locale,
      p_wording_versions: jsonArg(consentWordingVersions('onboarding', locale)),
      p_ip: ip,
      p_user_agent: store.get('user-agent'),
    }));
  } catch (e) {
    captureError(e, { area: 'onboarding.recordSignupConsents' });
  }
}

/** Buduje wiersz `candidate_profiles` dla kroków 2/3/4/6 (tylko kolumny danego kroku). */
function buildCandidateProfileRow(
  step: OnboardingStep,
  value: unknown,
  raw: unknown,
): Record<string, unknown> {
  type S2 = import('@/lib/validation/candidate').CandidateStep2;
  type S4 = import('@/lib/validation/candidate').CandidateStep4;
  type S6 = Omit<import('@/lib/validation/candidate').CandidateStep6, 'agreeTerms' | 'privacyNoticeAck'>;

  if (step === 2) {
    const v = value as S2;
    return { occupations: v.occupations, categories: v.categories };
  }
  if (step === 4) {
    const v = value as S4;
    return {
      city: v.city,
      region: nullIfEmpty(v.region),
      radius_km: v.radiusKm,
      has_driving_license: v.hasDrivingLicense,
      has_car: v.hasCar,
    };
  }
  // step === 6
  const v = value as S6;
  const rawObj = (raw ?? {}) as Record<string, unknown>;
  // Waluta nie jest częścią step6Schema (schemat zamrożony) — czytamy ją defensywnie z surowych
  // danych i akceptujemy tylko poprawny kod ISO (^[A-Z]{3}$); w innym wypadku zostaje domyślna DB.
  const currency =
    typeof rawObj.expectedSalaryCurrency === 'string' &&
    /^[A-Z]{3}$/.test(rawObj.expectedSalaryCurrency)
      ? rawObj.expectedSalaryCurrency
      : undefined;

  // Uwaga: profile_completed NIE jest ustawiane tutaj — liczy je DB (finish_onboarding, FUN-05).
  const row: Record<string, unknown> = {
    availability: v.availability,
    preferred_contract_types: v.preferredContractTypes,
    expected_salary_min: v.expectedSalaryMin ?? null,
    bio: nullIfEmpty(v.bio),
  };
  if (currency) row.expected_salary_currency = currency;
  return row;
}
