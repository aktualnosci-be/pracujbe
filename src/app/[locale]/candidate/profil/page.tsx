import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MapPin, Pencil } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  H2_EXTENDED,
  INFO_LABEL,
  INFO_PAIRS,
  INFO_VALUE,
  P_EXTENDED,
  PANEL,
  PANEL_H2,
  PAPER,
  TAG,
} from '@/components/dashboard/panel-styles';
import { DASH_GRID, DASH_GRID_SIDE } from '@/components/candidate/candidate-styles';
import { cn } from '@/lib/utils';
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
 * Panel kandydata — Profil. Wygląd: `#people/profile` z prototypu „04 Ludzie i praca”
 * (`.profile-banner`, `.paper`, `.info-pairs`), kompletność jako `.panel` z `.progress`.
 *
 * Read-only podsumowanie: imię, wskaźnik kompletności, checklista sekcji + dokumenty (CV) — realne
 * dane pod sesją (RLS); bez env dane DEMO. Edycja odbywa się w kreatorze onboardingu (odnośnik).
 * NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Teksty z i18n (`dashboard`).
 */

export const dynamic = 'force-dynamic';

/** Pusty stan pola `.info-pairs` — zwykły tekst muted zamiast pogrubionej wartości. */
const INFO_EMPTY = 'text-[15px] leading-[1.6] text-muted-foreground';

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

  const checklist = profileChecklistItems(profile.checklist, t('add'), to);
  const availabilityKey = passport.availability && passport.availability in availabilityLabels
    ? availabilityLabels[passport.availability as keyof typeof availabilityLabels]
    : null;

  return (
    <div className="min-w-0">
      {/* `profileScreen()` z prototypu: `.eyebrow`, `.extended h1`, `.dash-intro` + akcja edycji. */}
      <div className="flex min-w-0 flex-wrap items-end justify-between gap-5">
        <CandidatePageHeader eyebrow={tp('eyebrow')} title={tp('title')} intro={tp('intro')} />
        <Link href="/candidate/onboarding" className={cn(BTN_PRIMARY, 'mb-[25px]')}>
          <Pencil className="size-4 shrink-0" aria-hidden="true" />
          {tp('edit')}
        </Link>
      </div>

      {/* `.profile-banner` */}
      <CandidateIdentity
        profile={profile}
        passport={passport}
        labels={{
          eyebrow: tp('identityEyebrow'),
          emptyName: tp('identityEmptyName'),
          emptyIdentity: tp('identityEmpty'),
          loadError: tp('loadError'),
          availabilityLabel: to('availabilityLabel'),
          availability: !profile.loadFailed && !passport.loadFailed && availabilityKey ? to(availabilityKey) : null,
        }}
      />

      <div className={cn(DASH_GRID, 'mt-5')}>
        {/* `.paper` z polami profilu (`.info-pairs`) */}
        <section aria-labelledby="passport-heading" className={cn(PAPER, 'my-0 flex-[1.4_1_36rem]')}>
          <h2 id="passport-heading" className={H2_EXTENDED}>{tp('sectionTitle')}</h2>
          <p className={cn(P_EXTENDED, 'mt-1')}>{tp('sectionHint')}</p>
          {passport.loadFailed ? (
            <p role="alert" className="mt-5 text-[15px] text-error">{tp('loadError')}</p>
          ) : <div className={cn(INFO_PAIRS, 'mt-2 border-t border-border')}>
            <div className="min-w-0">
              <h3 className={INFO_LABEL}>{to('occupationsLabel')}</h3>
              {passport.occupations.length ? <ul className="flex flex-wrap gap-1.5">{passport.occupations.map((occupation) => <li key={occupation} className={cn(TAG, 'text-[13px] font-semibold text-foreground')}>{occupation}</li>)}</ul> : <p className={INFO_EMPTY}>{tp('emptyField')}</p>}
            </div>
            <div className="min-w-0">
              <h3 className={INFO_LABEL}>{to('city')}</h3>
              <p className={cn(INFO_VALUE, 'flex items-center gap-2')}>{passport.city ? <><MapPin className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />{passport.city}</> : <span className="font-normal text-muted-foreground">{tp('emptyField')}</span>}</p>
              {passport.city && passport.radiusKm !== null ? <p className="mt-1 text-[13px] text-muted-foreground">{tp('radius', { count: passport.radiusKm })}</p> : null}
            </div>
            <div className="min-w-0">
              <h3 className={INFO_LABEL}>{to('experienceLabel')}</h3>
              {passport.experienceYears !== null ? <p className={INFO_VALUE}>{tp('years', { count: passport.experienceYears })}</p> : <p className={INFO_EMPTY}>{tp('emptyField')}</p>}
            </div>
            <div className="min-w-0">
              <h3 className={INFO_LABEL}>{to('availabilityLabel')}</h3>
              {availabilityKey ? <p className={INFO_VALUE}>{to(availabilityKey)}</p> : <p className={INFO_EMPTY}>{tp('emptyField')}</p>}
            </div>
            {([['skills', to('skillsLabel'), passport.skills], ['languages', to('languagesLabel'), passport.languages], ['certificates', to('certificatesLabel'), passport.certificates]] as const).map(([key, label, values]) => <div key={key} className="col-span-2 min-w-0">
              <h3 className={INFO_LABEL}>{label}</h3>
              {values.length ? <ul className="flex flex-wrap gap-1.5">{values.map((value) => <li key={value} className={cn(TAG, 'text-[13px] text-foreground')}>{value}</li>)}</ul> : <p className={INFO_EMPTY}>{tp('emptyField')}</p>}
            </div>)}
          </div>}
        </section>

        <div className={DASH_GRID_SIDE}>
        {profile.loadFailed ? <ProfileSummaryError message={tp('loadError')} retry={tc('retry')} /> : <section className={PANEL}>
          <h2 className={PANEL_H2}>{t('profileCompleteness')}</h2>
          <ProfileCompleteness
            className="mt-2"
            value={profile.completionPct}
            title={getProfileLevelTitle(profile.completionPct, t('goodLevel'))}
            hint={t('completenessHint')}
          />
          <ProfileChecklist items={checklist} />
          <Link href="/candidate/onboarding" className={cn(BTN_SECONDARY, 'w-full')}>{t('completeProfile')}</Link>
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
