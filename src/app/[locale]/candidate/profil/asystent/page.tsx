import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { ProfileAssistPanel } from '@/components/candidate/ProfileAssistPanel';
import { isProfileAssistEnabled } from '@/lib/profile-assist/config';

/**
 * Panel kandydata — asystent budowania profilu z odpowiedzi (#37). Za flagą
 * `AI_PROFILE_ASSIST_ENABLED` (domyślnie wyłączona): bez niej strona nie istnieje (404),
 * a profil wypełnia się ręcznie w kreatorze. NOINDEX + guard sesji z `candidate/layout.tsx`.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'profileAssist' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function CandidateProfileAssistPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  if (!isProfileAssistEnabled()) notFound();
  const t = await getTranslations({ locale, namespace: 'profileAssist' });
  return (
    <div className="min-w-0 max-w-3xl">
      <CandidatePageHeader eyebrow={t('eyebrow')} title={t('title')} intro={t('intro')} />
      <ProfileAssistPanel />
    </div>
  );
}
