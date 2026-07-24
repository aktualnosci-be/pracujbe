'use server';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6Schema,
} from '@/lib/validation/candidate';

/**
 * Server Actions onboardingu kandydata — realny zapis kroków profilu do bazy.
 *
 * Każdy krok jest walidowany odpowiednim `stepNSchema` (to samo źródło prawdy, co po stronie
 * klienta) i zapisywany atomowo dla danego kroku:
 *   - krok 1 → `profiles` (first_name / last_name / phone; dane tożsamości są w profiles),
 *   - krok 3 → `candidate_profiles` (doświadczenie) + `candidate_skills` przez RPC (0028),
 *   - krok 5 → `candidate_languages` (z poziomem) + `candidate_certificates` przez RPC (0028),
 *   - kroki 2, 4, 6 → `candidate_profiles` (UPSERT po unikalnym `profile_id`),
 *   - krok 6 dodatkowo ustawia `profile_completed = true`.
 *
 * Relacje (skills/languages/certificates) zapisujemy transakcyjnie przez SECURITY DEFINER RPC
 * `set_candidate_*` (replace-all) — koniec cichej utraty danych z FUN-04. Bezpośredni DML na
 * tych tabelach jest odebrany klientowi (0028), więc RPC to jedyna ścieżka zapisu.
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
 */
export async function saveOnboardingStep(
  step: OnboardingStep,
  data: unknown,
): Promise<SaveOnboardingResult> {
  // 1) Walidacja odpowiednim schematem kroku (identyczna jak na kliencie).
  const parsed = validateStep(step, data);
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
      // Doświadczenie → candidate_profiles; umiejętności → relacja przez transakcyjne RPC (0028).
      const v = parsed.value as import('@/lib/validation/candidate').CandidateStep3;
      const { error: ue } = await supabase
        .from('candidate_profiles')
        .upsert({ profile_id: user.id, experience_years: v.experienceYears }, { onConflict: 'profile_id' });
      if (ue) return { ok: false, error: mapPgError(ue.message) };
      const { error: se } = await supabase.rpc('set_candidate_skills', { p_skills: v.skills });
      if (se) return { ok: false, error: mapPgError(se.message) };
      return { ok: true };
    }

    if (step === 5) {
      // Krok 5: języki (z poziomem) + certyfikaty → relacje przez transakcyjne RPC (0028).
      // Wcześniej dane były walidowane, ale NIE zapisywane (FUN-04, cicha utrata danych).
      const v = parsed.value as import('@/lib/validation/candidate').CandidateStep5;
      const langs = v.languages.map((l) => ({ language: l.language, level: l.level }));
      const { error: le } = await supabase.rpc('set_candidate_languages', { p_languages: langs });
      if (le) return { ok: false, error: mapPgError(le.message) };
      const { error: ce } = await supabase.rpc('set_candidate_certificates', {
        p_certificates: v.certificates,
      });
      if (ce) return { ok: false, error: mapPgError(ce.message) };
      return { ok: true };
    }

    // Kroki 2/4/6 → UPSERT do candidate_profiles po unikalnym profile_id.
    const row = buildCandidateProfileRow(step, parsed.value, data);
    const { error } = await supabase
      .from('candidate_profiles')
      .upsert({ profile_id: user.id, ...row }, { onConflict: 'profile_id' });
    if (error) return { ok: false, error: mapPgError(error.message) };
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
): { ok: true; value: unknown } | { ok: false } {
  const schema = {
    1: step1Schema,
    2: step2Schema,
    3: step3Schema,
    4: step4Schema,
    5: step5Schema,
    6: step6Schema,
  }[step];
  const result = schema.safeParse(data);
  return result.success ? { ok: true, value: result.data } : { ok: false };
}

/** Buduje wiersz `candidate_profiles` dla kroków 2/3/4/6 (tylko kolumny danego kroku). */
function buildCandidateProfileRow(
  step: OnboardingStep,
  value: unknown,
  raw: unknown,
): Record<string, unknown> {
  type S2 = import('@/lib/validation/candidate').CandidateStep2;
  type S4 = import('@/lib/validation/candidate').CandidateStep4;
  type S6 = import('@/lib/validation/candidate').CandidateStep6;

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

  const row: Record<string, unknown> = {
    availability: v.availability,
    preferred_contract_types: v.preferredContractTypes,
    expected_salary_min: v.expectedSalaryMin ?? null,
    bio: nullIfEmpty(v.bio),
    profile_completed: true,
  };
  if (currency) row.expected_salary_currency = currency;
  return row;
}
