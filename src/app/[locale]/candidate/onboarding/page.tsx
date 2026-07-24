import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  OnboardingWizard,
  type OnboardingInitialValues,
} from '@/components/candidate/OnboardingWizard';
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

/** Wczytuje wartości początkowe z DB (best-effort). Zwraca undefined w trybie demo / bez sesji. */
async function loadInitialValues(): Promise<OnboardingInitialValues | undefined> {
  if (!isSupabaseConfigured()) return undefined;

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return undefined;

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

    const p = profileRes.data as ProfileRow | null;
    const c = candidateRes.data as (CandidateProfileRow & { id: string }) | null;

    // P1-08: WCZYTAJ relacje (umiejętności/języki/certyfikaty), bo krok 3/5 zapisuje je przez
    // replace-all RPC — bez wczytania kreator startowałby z pustymi tablicami i przy „Dalej"
    // SKASOWAŁBY istniejące dane. Kluczujemy po candidate_profiles.id. Błąd odczytu relacji
    // rzuca → obsłużone niżej jako całościowy fallback (nie mieszamy „brak" z „błąd").
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
      // Rozróżniamy „brak danych" (data=[]) od „błąd odczytu" (error) — przy błędzie rzucamy,
      // by NIE wystartować z pustych relacji i nie skasować ich przypadkiem przy zapisie.
      if (skillsRes.error || langsRes.error || certsRes.error) {
        throw new Error('relations read failed');
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
    };
  } catch {
    // Onboarding musi działać nawet gdy odczyt profilu się nie powiedzie — startujemy z pustych pól.
    return undefined;
  }
}

export default async function CandidateOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const initialValues = await loadInitialValues();

  return <OnboardingWizard initialValues={initialValues} />;
}
