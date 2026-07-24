import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  OnboardingWizard,
  type OnboardingInitialValues,
} from '@/components/candidate/OnboardingWizard';
import { OnboardingLoadError } from '@/components/candidate/OnboardingLoadError';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';

/**
 * Onboarding kandydata — kreator profilu (makieta 06).
 *
 * Wrapper serwerowy: ustawia locale, metadane (NOINDEX — kreator) i renderuje kliencki
 * `OnboardingWizard`. Gdy Supabase jest skonfigurowane i użytkownik zalogowany, wczytuje
 * dotychczasowe dane profilu (profiles + candidate_profiles) jako wartości początkowe, aby
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
  if (!isSupabaseConfigured()) return { status: 'demo' };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'demo' }; // guard layoutu i tak przekieruje niezalogowanego

    const [profileRes, candidateRes] = await Promise.all([
      supabase.from('profiles').select('first_name,last_name,phone').eq('id', user.id).maybeSingle(),
      supabase
        .from('candidate_profiles')
        .select(
          'id,city,region,radius_km,has_driving_license,has_car,experience_years,availability,occupations,categories,preferred_contract_types,expected_salary_min,expected_salary_currency,bio',
        )
        .eq('profile_id', user.id)
        .maybeSingle(),
    ]);

    // P1-07: błąd odczytu profilu/candidate_profiles → stan błędu (NIE pusty formularz).
    if (profileRes.error || candidateRes.error) return { status: 'error' };

    const p = profileRes.data as ProfileRow | null;
    const c = candidateRes.data as (CandidateProfileRow & { id: string }) | null;

    // P1-08: WCZYTAJ relacje (umiejętności/języki/certyfikaty), bo krok 3/5 zapisuje je przez
    // replace-all RPC — bez wczytania kreator startowałby z pustymi tablicami i przy „Dalej"
    // SKASOWAŁBY istniejące dane. Kluczujemy po candidate_profiles.id.
    let skills: string[] | undefined;
    let languages: OnboardingInitialValues['languages'] | undefined;
    let certificates: string[] | undefined;
    if (c?.id) {
      const [skillsRes, langsRes, certsRes] = await Promise.all([
        supabase.from('candidate_skills').select('skill_label').eq('candidate_profile_id', c.id),
        supabase
          .from('candidate_languages')
          .select('language_label,level')
          .eq('candidate_profile_id', c.id),
        supabase
          .from('candidate_certificates')
          .select('certificate_label')
          .eq('candidate_profile_id', c.id),
      ]);
      // P1-07/P1-08: błąd odczytu relacji → stan błędu, by nie skasować danych przy zapisie.
      if (skillsRes.error || langsRes.error || certsRes.error) {
        return { status: 'error' };
      }
      skills = (skillsRes.data ?? []).map((r) => (r as { skill_label: string }).skill_label);
      languages = (langsRes.data ?? []).map((r) => {
        const row = r as { language_label: string; level: string };
        return { language: row.language_label, level: row.level };
      }) as OnboardingInitialValues['languages'];
      certificates = (certsRes.data ?? []).map(
        (r) => (r as { certificate_label: string }).certificate_label,
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

export default async function CandidateOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const result = await loadInitialValues();
  if (result.status === 'error') return <OnboardingLoadError />;

  return (
    <OnboardingWizard initialValues={result.status === 'ok' ? result.values : undefined} />
  );
}
