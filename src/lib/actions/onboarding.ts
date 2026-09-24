'use server';

import { getLocale } from 'next-intl/server';
import { headers } from 'next/headers';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
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
 * klienta) i zapisywany JEDNYM żądaniem do bazy — jedno żądanie = jedna transakcja, więc błąd
 * nie zostawia części kroku (#142):
 *   - krok 1 → `profiles` (first_name / last_name / phone; dane tożsamości są w profiles),
 *   - krok 3 → RPC `save_candidate_onboarding_step3` (0082): doświadczenie + umiejętności,
 *   - krok 5 → RPC `save_candidate_onboarding_step5` (0082): języki (z poziomem) + certyfikaty,
 *   - kroki 2, 4, 6 → `candidate_profiles` (UPSERT po unikalnym `profile_id`),
 *   - krok 6 z `finish: true` („Zakończ”) wymaga zgody, woła `finish_onboarding` i zapisuje
 *     receipt akceptacji regulaminu/polityki (`record_document_acceptance`, 0054); bez `finish`
 *     („Zapisz i wyjdź”, #337) zapisuje dane kroku bez zgody i bez kończenia onboardingu.
 *     Atomowy jest tu sam zapis danych kroku; `finish_onboarding` to osobne żądanie, które tylko
 *     sprawdza kompletność — dane kroku 6 zostają zapisane także przy `ONBOARDING_INCOMPLETE`
 *     (jak przy „Zapisz i wyjdź”), a receipt jest best-effort.
 *
 * Relacje (skills/languages/certificates) zapisują SECURITY DEFINER RPC (replace-all, limity
 * i normalizacja z `set_candidate_*`, 0028/0079) — koniec cichej utraty danych z FUN-04.
 * Bezpośredni DML na tych tabelach jest odebrany klientowi (0028), więc RPC to jedyna ścieżka zapisu.
 *
 * TRYB DEMO (Invariant: panele działają bez env): gdy Supabase nie jest skonfigurowane,
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
  if (!isSupabaseConfigured()) {
    return { ok: true, demo: true };
  }

  // 3) Autoryzacja — potrzebny zalogowany użytkownik.
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

  // 4) Zapis w zależności od kroku.
  try {
    if (step === 1) {
      const v = parsed.value as import('@/lib/validation/candidate').CandidateStep1;
      const { error } = await supabase
        .from('profiles')
        .update({
          first_name: v.firstName,
          last_name: v.lastName,
          phone: nullIfEmpty(v.phone),
        })
        .eq('id', user.id);
      if (error) return { ok: false, error: mapPgError(error.message) };
      return { ok: true };
    }

    if (step === 3) {
      // Doświadczenie + umiejętności w jednej transakcji (0082) — błąd umiejętności cofa też
      // doświadczenie, więc komunikat błędu odpowiada stanowi bazy (#142).
      const v = parsed.value as import('@/lib/validation/candidate').CandidateStep3;
      const { error } = await supabase.rpc('save_candidate_onboarding_step3', {
        p_experience_years: v.experienceYears,
        p_skills: v.skills,
      });
      if (error) return { ok: false, error: mapPgError(error.message) };
      return { ok: true };
    }

    if (step === 5) {
      // Języki (z poziomem) + certyfikaty w jednej transakcji (0082, #142).
      const v = parsed.value as import('@/lib/validation/candidate').CandidateStep5;
      const { error } = await supabase.rpc('save_candidate_onboarding_step5', {
        p_languages: v.languages.map((l) => ({ language: l.language, level: l.level })),
        // Certyfikat z datą ważności (#96) — matching pomija wygasłe; brak daty = bezterminowy.
        p_certificates: v.certificates.map((label) => ({
          label,
          expires_at: v.certificateExpiry[label] ?? null,
        })),
      });
      if (error) return { ok: false, error: mapPgError(error.message) };
      return { ok: true };
    }

    // Kroki 2/4/6 → UPSERT do candidate_profiles po unikalnym profile_id.
    const row = buildCandidateProfileRow(step, parsed.value, data);
    const { error } = await supabase
      .from('candidate_profiles')
      .upsert({ profile_id: user.id, ...row }, { onConflict: 'profile_id' });
    if (error) return { ok: false, error: mapPgError(error.message) };

    if (finish) {
      // Kompletność liczy DB z obecności wymaganych danych (FUN-05) — klient nie może już
      // sam ustawić profile_completed (kolumna odebrana; RPC definer waliduje i ustawia).
      const { data: complete, error: fe } = await supabase.rpc('finish_onboarding');
      if (fe) return { ok: false, error: mapPgError(fe.message) };
      // P1-07: NIE zgłaszaj sukcesu, gdy baza uznała profil za niekompletny — inaczej kreator
      // przekierowuje, a profil pozostaje niewyszukiwalny bez żadnego komunikatu (pozorna awaria).
      if (complete !== true) return { ok: false, error: 'ONBOARDING_INCOMPLETE' };
      await recordTermsAcceptance(user.id);
    }
    return { ok: true };
  } catch {
    // Nieoczekiwany błąd — bez technikaliów dla użytkownika (Invariant #8).
    return { ok: false, error: 'INTERNAL' };
  }
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
 * Niezmienny receipt akceptacji regulaminu i polityki prywatności z kroku 6 (#337) — to samo
 * gotowe RPC co przy rejestracji (0054, tylko service_role), kluczowane po zweryfikowanym
 * `user.id` z sesji. Best-effort jak w rejestracji: awaria receiptu nie cofa zapisanego profilu,
 * ale trafia do Sentry (rozliczalność).
 */
async function recordTermsAcceptance(profileId: string): Promise<void> {
  try {
    const store = await headers();
    const ip =
      store.get('x-real-ip')?.trim() ||
      store.get('x-forwarded-for')?.split(',').map((p) => p.trim()).filter(Boolean).pop() ||
      null;
    const { error } = await createAdminClient().rpc('record_document_acceptance', {
      p_profile_id: profileId,
      p_documents: ['terms', 'privacy'],
      p_locale: await getLocale(),
      p_ip: ip,
      p_user_agent: store.get('user-agent'),
    });
    if (error) captureError(error, { area: 'onboarding.recordDocumentAcceptance' });
  } catch (e) {
    captureError(e, { area: 'onboarding.recordDocumentAcceptance' });
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
  type S6 = Omit<import('@/lib/validation/candidate').CandidateStep6, 'agreeTerms'>;

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
