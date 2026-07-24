import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { CvUpload } from '@/components/candidate/CvUpload';
import { getCandidateProfileSummary, getCandidateFiles } from '@/lib/data/candidate';

/**
 * Panel kandydata — Profil (podgląd; makieta 04, kolumna „Kompletność profilu").
 *
 * Read-only podsumowanie: imię, wskaźnik kompletności, checklista sekcji + dokumenty (CV) — realne
 * dane pod sesją (RLS); bez env dane DEMO. Edycja odbywa się w kreatorze onboardingu (odnośnik).
 * NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Teksty z i18n (`dashboard`).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navProfile'),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateProfilePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const [profile, files] = await Promise.all([
    getCandidateProfileSummary(),
    getCandidateFiles(),
  ]);

  const checklist = [
    { label: t('checkBasicInfo'), done: profile.checklist.basicInfo, action: t('add') },
    { label: t('checkExperience'), done: profile.checklist.experience, action: t('add') },
    { label: t('checkEducation'), done: profile.checklist.education, action: t('add') },
    { label: t('checkSkills'), done: profile.checklist.skills, action: t('add') },
    { label: t('checkLanguages'), done: profile.checklist.languages, action: t('add') },
    { label: t('checkPhoto'), done: profile.checklist.photo, action: t('add') },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">
        {profile.firstName ? t('greeting', { name: profile.firstName }) : t('navProfile')}
      </h1>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Kompletność profilu + checklista sekcji */}
        <section className="rounded-lg border border-border bg-card p-4 sm:p-5">
          <h2 className="text-base font-semibold text-foreground">{t('profileCompleteness')}</h2>
          <ProfileCompleteness
            className="mt-4"
            value={profile.completionPct}
            title={t('goodLevel')}
            hint={t('completenessHint')}
          />
          <ProfileChecklist className="mt-5" items={checklist} />
          <Button asChild className="mt-5 w-full">
            <Link href="/candidate/onboarding">{t('completeProfile')}</Link>
          </Button>
        </section>

        {/* Dokumenty / CV (prywatny bucket + signed URLs) */}
        <CvUpload items={files} />
      </div>
    </div>
  );
}
