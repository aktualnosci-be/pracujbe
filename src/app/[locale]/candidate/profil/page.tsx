import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { BriefcaseBusiness, MapPin, Pencil } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { ProfileCompleteness } from '@/components/candidate/ProfileCompleteness';
import { ProfileChecklist } from '@/components/candidate/ProfileChecklist';
import { ProfileSummaryError } from '@/components/candidate/ProfileSummaryError';
import { CvUpload } from '@/components/candidate/CvUpload';
import { CandidateIdentity } from '@/components/candidate/CandidateIdentity';
import { getCandidateProfileSummary, getCandidatePassport } from '@/lib/data/candidate';
import { loadCandidateFiles } from '@/lib/data/candidate-files';
import { profileChecklistItems } from '@/components/candidate/profile-checklist-items';
import { getProfileLevelTitle } from '@/lib/profile-completeness';

/**
 * Panel kandydata — Profil (podgląd; makieta 04, kolumna „Kompletność profilu").
 *
 * Read-only podsumowanie: imię, wskaźnik kompletności, checklista sekcji + dokumenty (CV) — realne
 * dane pod sesją (RLS); bez env dane DEMO. Edycja odbywa się w kreatorze onboardingu (odnośnik).
 * NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Teksty z i18n (`dashboard`).
 */

export const dynamic = 'force-dynamic';

const availabilityLabels = {
  immediate: 'availImmediate',
  within_month: 'availWithinMonth',
  within_three_months: 'availWithinThreeMonths',
  flexible: 'availFlexible',
} as const;

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

  const [t, tp, to, tc] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard' }),
    getTranslations({ locale, namespace: 'candidatePassport' }),
    getTranslations({ locale, namespace: 'onboarding' }),
    getTranslations({ locale, namespace: 'common' }),
  ]);
  const [profile, passport, files] = await Promise.all([
    getCandidateProfileSummary(),
    getCandidatePassport(),
    loadCandidateFiles(),
  ]);

  const checklist = profileChecklistItems(profile.checklist, t, to('none'));
  const availabilityKey = passport.availability && passport.availability in availabilityLabels
    ? availabilityLabels[passport.availability as keyof typeof availabilityLabels]
    : null;

  return (
    <div className="min-w-0 space-y-6">
      <header className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-8">
        <span className="text-xs font-bold uppercase tracking-[0.16em] text-accent">{tp('eyebrow')}</span>
        <div className="mt-3 flex flex-wrap items-end justify-between gap-5">
          <div className="min-w-0">
            <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl">{tp('title')}</h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground sm:text-base">{tp('intro')}</p>
          </div>
          <Button asChild className="min-h-12 rounded-xl">
            <Link href="/candidate/onboarding"><Pencil className="mr-2 h-4 w-4" aria-hidden="true" />{tp('edit')}</Link>
          </Button>
        </div>
      </header>

      <CandidateIdentity
        profile={profile}
        passport={passport}
        labels={{
          eyebrow: tp('identityEyebrow'),
          emptyName: tp('identityEmptyName'),
          emptyIdentity: tp('identityEmpty'),
          loadError: tp('loadError'),
          availability: !profile.loadFailed && !passport.loadFailed && availabilityKey ? to(availabilityKey) : null,
        }}
      />

      <div className="grid min-w-0 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)]">
        <section aria-labelledby="passport-heading" className="min-w-0 overflow-hidden rounded-[1.75rem] border border-border bg-card">
          <div className="border-b border-border bg-soft p-5 sm:p-7">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground" aria-hidden="true"><BriefcaseBusiness className="h-5 w-5" /></span>
            <h2 id="passport-heading" className="mt-4 text-xl font-bold text-foreground sm:text-2xl">{tp('sectionTitle')}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{tp('sectionHint')}</p>
          </div>
          {passport.loadFailed ? (
            <p role="alert" className="p-5 text-sm text-error sm:p-7">{tp('loadError')}</p>
          ) : <div className="grid gap-6 p-5 sm:grid-cols-2 sm:p-7">
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{to('occupationsLabel')}</h3>
              {passport.occupations.length ? <ul className="mt-3 flex flex-wrap gap-2">{passport.occupations.map((occupation) => <li key={occupation} className="max-w-full break-words rounded-full border border-border bg-background px-3 py-1.5 text-sm font-semibold text-foreground">{occupation}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{tp('emptyField')}</p>}
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{to('city')}</h3>
              <p className="mt-3 flex items-center gap-2 text-base font-semibold text-foreground">{passport.city ? <><MapPin className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />{passport.city}</> : tp('emptyField')}</p>
              {passport.city && passport.radiusKm !== null ? <p className="mt-1 text-sm text-muted-foreground">{tp('radius', { count: passport.radiusKm })}</p> : null}
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{to('experienceLabel')}</h3>
              <p className="mt-3 text-base font-semibold text-foreground">{passport.experienceYears !== null ? tp('years', { count: passport.experienceYears }) : tp('emptyField')}</p>
            </div>
            <div>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{to('availabilityLabel')}</h3>
              <p className="mt-3 text-base font-semibold text-foreground">{availabilityKey ? to(availabilityKey) : tp('emptyField')}</p>
            </div>
            {([['skills', to('skillsLabel'), passport.skills], ['languages', to('languagesLabel'), passport.languages], ['certificates', to('certificatesLabel'), passport.certificates]] as const).map(([key, label, values]) => <div key={key} className="min-w-0 sm:col-span-2">
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{label}</h3>
              {values.length ? <ul className="mt-3 flex flex-wrap gap-2">{values.map((value) => <li key={value} className="max-w-full break-words rounded-xl bg-soft px-3 py-2 text-sm text-foreground">{value}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">{tp('emptyField')}</p>}
            </div>)}
          </div>}
        </section>

        <div className="min-w-0 space-y-6">
        {profile.loadFailed ? <ProfileSummaryError message={tp('loadError')} retry={tc('retry')} /> : <section className="rounded-[1.75rem] border border-border bg-card p-5 sm:p-6">
          <h2 className="text-base font-semibold text-foreground">{t('profileCompleteness')}</h2>
          <ProfileCompleteness
            className="mt-4"
            value={profile.completionPct}
            title={getProfileLevelTitle(profile.completionPct, t('goodLevel'))}
            hint={t('completenessHint')}
          />
          <ProfileChecklist className="mt-5" items={checklist} />
          <Link href="/candidate/onboarding" className="mt-5 inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-border px-4 text-sm font-semibold text-foreground hover:bg-soft">{t('completeProfile')}</Link>
        </section>}

        {/* Dokumenty / CV (prywatny bucket + signed URLs) */}
        <CvUpload
          items={files.status === 'ready' ? files.items : []}
          loadFailed={files.status === 'error'}
        />
        </div>
      </div>
    </div>
  );
}
