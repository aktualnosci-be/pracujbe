import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  OnboardingWizard,
  type OnboardingInitialValues,
  type OnboardingStepNumber,
} from '@/components/candidate/OnboardingWizard';
import { OnboardingLoadError } from '@/components/candidate/OnboardingLoadError';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryOne, queryRows } from '@/lib/db/sql';

/**
 * Onboarding kandydata — kreator profilu (makieta 06).
 *
 * Wrapper serwerowy: ustawia locale, metadane (NOINDEX — kreator) i renderuje kliencki
 * `OnboardingWizard`. Gdy baza jest skonfigurowana i użytkownik zalogowany, wczytuje (pod sesją,
 * `withPortalTransaction`) dotychczasowe dane profilu (profiles + candidate_profiles + relacje)
 * jako wartości początkowe, aby
 * kreator wznawiał wypełnianie. W trybie demo (brak env) — puste pola.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'onboarding' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

/** Kształt wierszy odczytywanych z DB (podzbiór kolumn edytowalnych w onboardingu). */
interface ProfileRow {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
}
interface CandidateProfileRow {
  city: string | null;
  region: string | null;
  radius_km: number | null;
  has_driving_license: boolean | null;
  has_car: boolean | null;
  experience_years: number | null;
  availability: OnboardingInitialValues['availability'] | null;
  occupations: string[] | null;
  categories: NonNullable<OnboardingInitialValues['categories']> | null;
  preferred_contract_types: NonNullable<OnboardingInitialValues['preferredContractTypes']> | null;
  expected_salary_min: number | null;
  expected_salary_currency: string | null;
  bio: string | null;
}

/**
 * Wynik wczytania (P1-07): jawnie rozróżniamy stany, by NIGDY nie zmieniać przejściowego błędu
 * odczytu w pusty edytor (zapis „replace-all" skasowałby istniejące dane):
 *   - 'demo'  — brak env / brak sesji → kreator startuje pusty (nie ma czego stracić),
 *   - 'ok'    — wczytano poprawnie (dla nowego profilu wartości mogą być puste),
 *   - 'error' — którykolwiek odczyt zawiódł → pokazujemy retry, NIE montujemy edytora.
 */
type LoadResult =
  | { status: 'demo' }
  | { status: 'ok'; values: OnboardingInitialValues }
  | { status: 'error' };

async function loadInitialValues(): Promise<LoadResult> {
  if (!isPortalDataConfigured()) return { status: 'demo' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'demo' }; // guard layoutu i tak przekieruje niezalogowanego

    // Jedna transakcja: błąd dowolnego odczytu przerywa całość → stan błędu (P1-07).
    const loaded = await withPortalTransaction(me, async (tx) => {
      const p = await queryOne<ProfileRow>(tx, 'onboarding.load-profile',
        'SELECT first_name, last_name, phone FROM public.profiles WHERE id = $1', [me.id]);
      const c = await queryOne<CandidateProfileRow & { id: string }>(tx, 'onboarding.load-candidate-profile',
        `SELECT id, city, region, radius_km, has_driving_license, has_car, experience_years, availability,
                occupations, categories, preferred_contract_types, expected_salary_min,
                expected_salary_currency, bio
           FROM public.candidate_profiles
          WHERE profile_id = $1`, [me.id]);
      // P1-08: WCZYTAJ relacje (umiejętności/języki/certyfikaty), bo krok 3/5 zapisuje je przez
      // replace-all RPC — bez wczytania kreator startowałby z pustymi tablicami i przy „Dalej"
      // SKASOWAŁBY istniejące dane. Kluczujemy po candidate_profiles.id.
      if (!c?.id) return { p, c, relations: null };
      const skills = await queryRows<{ skill_label: string }>(tx, 'onboarding.load-skills',
        'SELECT skill_label FROM public.candidate_skills WHERE candidate_profile_id = $1', [c.id]);
      const langs = await queryRows<{ language_label: string; level: string }>(tx, 'onboarding.load-languages',
        'SELECT language_label, level FROM public.candidate_languages WHERE candidate_profile_id = $1', [c.id]);
      const certs = await queryRows<{ certificate_label: string; expires_at: string | null }>(
        tx, 'onboarding.load-certificates',
        'SELECT certificate_label, expires_at FROM public.candidate_certificates WHERE candidate_profile_id = $1',
        [c.id]);
      return { p, c, relations: { skills, langs, certs } };
    });
    const { p, c, relations } = loaded;

    let skills: string[] | undefined;
    let languages: OnboardingInitialValues['languages'] | undefined;
    let certificates: string[] | undefined;
    let certificateExpiry: Record<string, string> | undefined;
    if (relations) {
      skills = relations.skills.map((r) => r.skill_label);
      languages = relations.langs.map((row) => ({
        language: row.language_label,
        level: row.level,
      })) as OnboardingInitialValues['languages'];
      certificates = relations.certs.map((r) => r.certificate_label);
      certificateExpiry = Object.fromEntries(
        relations.certs.filter((r) => r.expires_at).map((r) => [r.certificate_label, String(r.expires_at).slice(0, 10)]),
      );
    }

    return {
      status: 'ok',
      values: {
        firstName: p?.first_name ?? undefined,
        lastName: p?.last_name ?? undefined,
        phone: p?.phone ?? undefined,
        occupations: c?.occupations ?? undefined,
        categories: c?.categories ?? undefined,
        experienceYears: c?.experience_years ?? undefined,
        skills,
        city: c?.city ?? undefined,
        region: c?.region ?? undefined,
        radiusKm: c?.radius_km ?? undefined,
        hasDrivingLicense: c?.has_driving_license ?? undefined,
        hasCar: c?.has_car ?? undefined,
        availability: c?.availability ?? undefined,
        languages,
        certificates,
        certificateExpiry,
        preferredContractTypes: c?.preferred_contract_types ?? undefined,
        expectedSalaryMin: c?.expected_salary_min ?? undefined,
        expectedSalaryCurrency: c?.expected_salary_currency ?? undefined,
        bio: c?.bio ?? undefined,
      },
    };
  } catch {
    // P1-07: wyjątek odczytu → stan błędu (retry), NIGDY pusty edytor kasujący dane.
    return { status: 'error' };
  }
}

/** `?step=N` (1–6) otwiera wskazany krok (linki „Dodaj" z checklisty profilu, #317). */
function parseStep(value: string | string[] | undefined): OnboardingStepNumber {
  const raw = Array.isArray(value) ? value[0] : value;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= 6 ? (n as OnboardingStepNumber) : 1;
}

export default async function CandidateOnboardingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const initialStep = parseStep((await searchParams)['step']);

  const result = await loadInitialValues();
  if (result.status === 'error') return <OnboardingLoadError />;

  return (
    <OnboardingWizard
      initialValues={result.status === 'ok' ? result.values : undefined}
      initialStep={initialStep}
    />
  );
}
