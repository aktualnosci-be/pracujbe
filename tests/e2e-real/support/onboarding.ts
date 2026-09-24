import {
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6DraftSchema,
  step6Schema,
  type CandidateStep1,
  type CandidateStep2,
  type CandidateStep3,
  type CandidateStep4,
  type CandidateStep5,
  type CandidateStep6,
} from '../../../src/lib/validation/candidate';
import { rows, type Actor } from './stack';

/**
 * Kontrakt zapisu i wczytania kreatora onboardingu (#66) na docelowej ścieżce Railway.
 *
 * `saveStep` odwzorowuje `saveOnboardingStep` (src/lib/actions/onboarding.ts) krok po kroku:
 * ten sam schemat Zod kroku (import z produkcji, więc walidacja pól jest prawdziwa), to samo
 * mapowanie na kolumny/RPC i ten sam kod błędu; zamiast klienta Supabase — jedno żądanie pod
 * sesją z cookie (tożsamość = auth.uid(), bez userId z testu) i RLS.
 * `loadWizard` odwzorowuje `loadInitialValues` (candidate/onboarding/page.tsx), czyli to, co
 * kreator dostaje po pełnym przeładowaniu — łącznie z relacjami (P1-08).
 *
 * Akcja i strona nadal używają klienta Supabase; po #24/#25 te helpery mają zostać zastąpione
 * wywołaniem samej akcji/strony (ten sam scenariusz testu).
 */

export type Step = 1 | 2 | 3 | 4 | 5 | 6;
export type SaveResult = { ok: true } | { ok: false; error: string; issues?: string[] };

const SCHEMAS = {
  1: step1Schema,
  2: step2Schema,
  3: step3Schema,
  4: step4Schema,
  5: step5Schema,
} as const;

/** Jak `mapPgError` w akcji: komunikat Postgresa → kod użytkowy (Invariant #8). */
function mapPgError(message: string): string {
  if (message.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (message.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (/PERMISSION_DENIED|UNAUTHENTICATED|row-level security|permission denied/.test(message)) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

const blankToNull = (value: string | undefined) => value?.trim() || null;

export async function saveStep(
  actor: Actor,
  step: Step,
  data: unknown,
  options: { finish?: boolean } = {},
): Promise<SaveResult> {
  const finish = step === 6 && options.finish === true;
  const schema = step === 6 ? (finish ? step6Schema : step6DraftSchema) : SCHEMAS[step];
  const parsed = schema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, error: 'VALIDATION_FAILED', issues: parsed.error.issues.map((i) => i.message) };
  }
  const value = parsed.data;

  try {
    return await actor.request(async (tx): Promise<SaveResult> => {
      if (step === 1) {
        const v = value as CandidateStep1;
        await tx.query('UPDATE public.profiles SET first_name = $1, last_name = $2, phone = $3 WHERE id = auth.uid()',
          [v.firstName, v.lastName, blankToNull(v.phone)]);
        return { ok: true };
      }
      if (step === 3) {
        const v = value as CandidateStep3;
        await tx.query('SELECT public.save_candidate_onboarding_step3(p_experience_years => $1, p_skills => $2)',
          [v.experienceYears, v.skills]);
        return { ok: true };
      }
      if (step === 5) {
        const v = value as CandidateStep5;
        await tx.query('SELECT public.save_candidate_onboarding_step5(p_languages => $1, p_certificates => $2)', [
          JSON.stringify(v.languages.map((l) => ({ language: l.language, level: l.level }))),
          JSON.stringify(v.certificates.map((label) => ({ label, expires_at: v.certificateExpiry[label] ?? null }))),
        ]);
        return { ok: true };
      }
      await upsertCandidateProfile(tx, candidateProfileRow(step, value));
      return { ok: true };
    }).then(async (saved) => {
      if (!saved.ok || !finish) return saved;
      // Jak w akcji: finalizacja to osobne żądanie; dane kroku 6 zostają zapisane także przy
      // ONBOARDING_INCOMPLETE. Kompletność liczy baza (FUN-05), sukces tylko przy `true` (P1-07).
      const complete = await actor.request(async (tx) =>
        rows<{ value: boolean }>(await tx.query('SELECT public.finish_onboarding() AS value'))[0]?.value);
      return complete === true ? { ok: true } : { ok: false, error: 'ONBOARDING_INCOMPLETE' };
    });
  } catch (error) {
    return { ok: false, error: mapPgError(error instanceof Error ? error.message : String(error)) };
  }
}

function candidateProfileRow(step: Step, value: unknown): Record<string, unknown> {
  if (step === 2) {
    const v = value as CandidateStep2;
    return { occupations: v.occupations, categories: v.categories };
  }
  if (step === 4) {
    const v = value as CandidateStep4;
    return {
      city: v.city, region: blankToNull(v.region), radius_km: v.radiusKm,
      has_driving_license: v.hasDrivingLicense, has_car: v.hasCar,
    };
  }
  const v = value as Omit<CandidateStep6, 'agreeTerms'>;
  return {
    availability: v.availability,
    preferred_contract_types: v.preferredContractTypes,
    expected_salary_min: v.expectedSalaryMin ?? null,
    bio: blankToNull(v.bio),
  };
}

async function upsertCandidateProfile(tx: { query(text: string, values?: unknown[]): Promise<unknown> },
  columns: Record<string, unknown>) {
  const names = Object.keys(columns);
  if (!names.every((n) => /^[a-z_]+$/.test(n))) throw new Error('Nieprawidłowa kolumna.');
  await tx.query(
    `INSERT INTO public.candidate_profiles (profile_id, ${names.join(', ')})
     VALUES (auth.uid(), ${names.map((_, i) => `$${i + 1}`).join(', ')})
     ON CONFLICT (profile_id) DO UPDATE SET ${names.map((n) => `${n} = EXCLUDED.${n}`).join(', ')}`,
    Object.values(columns));
}

/** Wartości początkowe kreatora po pełnym przeładowaniu (jak `loadInitialValues`). */
export type WizardValues = {
  firstName?: string;
  lastName?: string;
  phone?: string;
  occupations?: string[];
  categories?: string[];
  experienceYears?: number;
  skills?: string[];
  city?: string;
  region?: string;
  radiusKm?: number;
  hasDrivingLicense?: boolean;
  hasCar?: boolean;
  languages?: { language: string; level: string }[];
  certificates?: string[];
  certificateExpiry?: Record<string, string>;
  availability?: string;
  preferredContractTypes?: string[];
  expectedSalaryMin?: number;
  bio?: string;
};

export async function loadWizard(actor: Actor): Promise<WizardValues> {
  return actor.request(async (tx) => {
    const [p] = rows<Record<string, string | null>>(await tx.query(
      'SELECT first_name, last_name, phone FROM public.profiles WHERE id = auth.uid()'));
    const [c] = rows<Record<string, unknown>>(await tx.query(
      `SELECT id, city, region, radius_km, has_driving_license, has_car, experience_years, availability::text,
         occupations, categories::text[] AS categories, preferred_contract_types::text[] AS preferred_contract_types,
         expected_salary_min, bio
       FROM public.candidate_profiles WHERE profile_id = auth.uid()`));
    const values: WizardValues = {
      firstName: p?.first_name ?? undefined,
      lastName: p?.last_name ?? undefined,
      phone: p?.phone ?? undefined,
    };
    if (!c) return values;
    // Kolejność wierszy jak z PostgREST (bez ORDER BY) nie jest gwarantowana — sortujemy tylko
    // do porównań w teście, nie zmienia to zawartości.
    const skills = rows<{ skill_label: string }>(await tx.query(
      'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1 ORDER BY skill_label', [c.id]));
    const languages = rows<{ language_label: string; level: string }>(await tx.query(
      `SELECT language_label, level::text FROM public.candidate_languages
       WHERE candidate_profile_id = $1 ORDER BY language_label`, [c.id]));
    const certificates = rows<{ certificate_label: string; expires_at: string | null }>(await tx.query(
      `SELECT certificate_label, expires_at::text FROM public.candidate_certificates
       WHERE candidate_profile_id = $1 ORDER BY certificate_label`, [c.id]));
    const opt = <T>(v: unknown) => (v ?? undefined) as T | undefined;
    return {
      ...values,
      occupations: opt(c.occupations),
      categories: opt(c.categories),
      experienceYears: opt(c.experience_years),
      skills: skills.map((r) => r.skill_label),
      city: opt(c.city),
      region: opt(c.region),
      radiusKm: opt(c.radius_km),
      hasDrivingLicense: opt(c.has_driving_license),
      hasCar: opt(c.has_car),
      availability: opt(c.availability),
      languages: languages.map((r) => ({ language: r.language_label, level: r.level })),
      certificates: certificates.map((r) => r.certificate_label),
      certificateExpiry: Object.fromEntries(certificates.filter((r) => r.expires_at)
        .map((r) => [r.certificate_label, r.expires_at!.slice(0, 10)])),
      preferredContractTypes: opt(c.preferred_contract_types),
      expectedSalaryMin: opt(c.expected_salary_min),
      bio: opt(c.bio),
    };
  });
}

/** Flagi liczone przez bazę (odczyt pod sesją właściciela). */
export async function flags(actor: Actor): Promise<{ profile_completed: boolean; is_searchable: boolean } | undefined> {
  return actor.request(async (tx) => rows<{ profile_completed: boolean; is_searchable: boolean }>(await tx.query(
    'SELECT profile_completed, is_searchable FROM public.candidate_profiles WHERE profile_id = auth.uid()'))[0]);
}
