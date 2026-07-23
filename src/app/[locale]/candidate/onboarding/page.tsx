import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { OnboardingWizard } from '@/components/candidate/OnboardingWizard';

/**
 * Onboarding kandydata — krok 1 „Dane podstawowe" (makieta 06).
 *
 * Cienki wrapper serwerowy: ustawia locale, metadane (NOINDEX — panel/kreator) i renderuje
 * kliencki `OnboardingWizard` (interaktywny formularz). Dane DEMO, backend niepodpięty.
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

export default async function CandidateOnboardingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return <OnboardingWizard />;
}
