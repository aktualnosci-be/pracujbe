import * as React from 'react';
import type { Metadata } from 'next';
import { Bookmark } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { CandidateJobPassport } from '@/components/candidate/CandidateJobPassport';
import { CandidatePageHeader } from '@/components/candidate/CandidatePageHeader';
import { SavedJobUnavailableItem } from '@/components/candidate/SavedJobUnavailableItem';
import { SavedJobsCompareForm } from '@/components/candidate/SavedJobsCompareForm';
import { SavedJobsComparison } from '@/components/candidate/SavedJobsComparison';
import { BTN_PRIMARY, BTN_SECONDARY, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';
import { getSavedJobs } from '@/lib/data/candidate';
import { routing } from '@/i18n/routing';
import { getJobBySlug } from '@/lib/jobs';
import { salaryLabelsFor } from '@/lib/salary-labels';
import { SAVED_JOB_STATE_KEYS } from '@/lib/saved-job-availability';
import {
  buildCompareModel,
  parseCompareSelection,
  type CompareLoad,
} from '@/lib/saved-job-compare';
import { formatEuro, type JobCostLabels } from '@/lib/job-costs';

/**
 * Panel kandydata — Zapisane oferty (makieta 04, nawigacja „Zapisane oferty").
 *
 * Dane realne pod sesją (RLS: własne `saved_jobs`) z `getSavedJobs` — każdy zapis ze stanem
 * oferty (0162); oferta bez strony publicznej = `SavedJobUnavailableItem` (stan, bez linku,
 * „Usuń z zapisanych”); bez env dane DEMO. NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Zapis oferty
 * przez `SaveJobButton` (odznaczenie usuwa z listy po odświeżeniu); teksty z i18n (`dashboard`).
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
    title: t('navSaved'),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateSavedPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  const query = await searchParams;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });
  const saved = await getSavedJobs(locale);

  // #816: porównanie warunków 2–3 zapisanych ofert (`?porownaj=`) — tylko własne zapisy.
  const selection = parseCompareSelection(
    query['porownaj'],
    new Set(saved.status === 'ready' ? saved.jobs.map((job) => job.id.toLowerCase()) : []),
  );
  const pageLocale = (routing.locales as readonly string[]).includes(locale)
    ? (locale as (typeof routing.locales)[number])
    : routing.defaultLocale;
  let comparison: React.ReactNode = null;
  if (saved.status === 'ready' && selection.requested) {
    if (selection.ids.length < 2) {
      comparison = (
        <p role="status" className={cn(PAPER, P_EXTENDED, 'mb-[25px] text-foreground')}>{t('compareNeedTwo')}</p>
      );
    } else {
      const [tJob, tContract, tCommon] = await Promise.all([
        getTranslations({ locale, namespace: 'job' }),
        getTranslations({ locale, namespace: 'contractTypes' }),
        getTranslations({ locale, namespace: 'common' }),
      ]);
      const loads: Record<string, CompareLoad> = {};
      await Promise.all(
        selection.ids.map(async (id) => {
          const job = saved.jobs.find((entry) => entry.id.toLowerCase() === id);
          if (!job || job.availability !== 'available' || !job.slug) return;
          try {
            const detail = await getJobBySlug(job.slug, locale);
            loads[id] = detail ? { status: 'ok', detail } : { status: 'unavailable' };
          } catch {
            loads[id] = { status: 'error' };
          }
        }),
      );
      const costLabels: JobCostLabels = {
        accommodation: tJob('accommodation'),
        transport: tJob('transport'),
        mealVouchers: tJob('mealVouchers'),
        jointCommittee: tJob('jointCommittee'),
        yes: tCommon('yes'),
        no: tCommon('no'),
        kind: (kind) => tJob(`costs.kind.${kind}`),
        cost: (amount, period) => tJob('costs.cost', { amount, period }),
        free: tJob('costs.free'),
        deducted: (yes) => tJob(yes ? 'costs.deductedYes' : 'costs.deductedNo'),
        registration: (yes) => tJob(yes ? 'costs.registrationYes' : 'costs.registrationNo'),
        afterContract: (value) => tJob(`costs.afterContract.${value}`),
        shuttle: tJob('costs.shuttle'),
        reimbursed: tJob('costs.reimbursed'),
        mealPerDay: (amount) => tJob('costs.mealPerDay', { amount }),
        committeeCode: (code) => tJob('costs.committeeCode', { code }),
        money: (amount) => formatEuro(amount, pageLocale),
      };
      const model = buildCompareModel(selection.ids, saved.jobs, loads, {
        locale: pageLocale,
        salaryLabels: salaryLabelsFor(locale),
        contract: (type) => tContract(type),
        costLabels,
      });
      comparison = (
        <>
          {selection.truncated ? (
            <p role="status" className="mb-3 text-sm text-muted-foreground">{t('compareTruncated')}</p>
          ) : null}
          <SavedJobsComparison
            model={model}
            headingId="saved-compare-title"
            closeHref="/candidate/zapisane"
            labels={{
              title: t('compareTitle'),
              caption: t('compareCaption'),
              offerColumn: t('compareOfferColumn'),
              noData: t('compareNoData'),
              unavailableCell: t('compareUnavailableCell'),
              viewOffer: t('compareViewOffer'),
              close: t('compareClose'),
              detailsError: t('compareDetailsError'),
              rows: {
                salary: t('compareRowSalary'),
                contract: t('compareRowContract'),
                hours: t('compareRowHours'),
                shifts: t('compareRowShifts'),
                accommodation: t('compareRowAccommodation'),
                transport: t('compareRowTransport'),
                requirements: t('compareRowRequirements'),
              },
              state: (state) => t(SAVED_JOB_STATE_KEYS[state]),
            }}
          />
        </>
      );
    }
  }
  const selectedIds = new Set(selection.ids);

  return (
    <div className="min-w-0">
      <CandidatePageHeader eyebrow={t('candidatePlaceEyebrow')} title={t('navSaved')} intro={t('savedIntro')} />

      {comparison}

      {/* `savedScreen()`: `.p-job-grid` z kartami-paszportami albo `.paper.empty`. */}
      {saved.status === 'error' ? (
        <section role="alert" className={PAPER}>
          <p className={cn(P_EXTENDED, 'text-foreground')}>{t('savedError')}</p>
          <Link href="/candidate/zapisane" className={cn(BTN_SECONDARY, 'mt-4')}>{t('savedRetry')}</Link>
        </section>
      ) : saved.jobs.length === 0 ? (
        <section className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
          <Bookmark className="mx-auto h-8 w-8 text-primary" aria-hidden="true" />
          <p className={cn(P_EXTENDED, 'mt-3')}>{t('savedEmpty')}</p>
          <Link href="/oferty-pracy" className={cn(BTN_PRIMARY, 'mt-5')}>{t('savedBrowse')}</Link>
        </section>
      ) : (
        <SavedJobsCompareForm>
          <ul className="pp-job-grid max-[950px]:grid-cols-1">
            {saved.jobs.map((job) =>
              job.availability === 'available' ? (
                <li key={job.id}>
                  <CandidateJobPassport
                    job={{ ...job, saved: true }}
                    labels={{ location: tj('passport.location'), viewOffer: tj('passport.viewOffer') }}
                  >
                    {/* #816: zaznaczenie do porównania nad nakładką linku karty (z-10), cel min. 44 px. */}
                    <label className="relative z-10 mt-3 flex min-h-11 w-fit items-center gap-3 text-sm text-foreground">
                      <input
                        type="checkbox"
                        name="porownaj"
                        value={job.id}
                        defaultChecked={selectedIds.has(job.id.toLowerCase())}
                        className="h-5 w-5 accent-[color:var(--primary)]"
                      />
                      <span>
                        {t('compareSelect')}
                        <span className="sr-only">: {job.title}</span>
                      </span>
                    </label>
                  </CandidateJobPassport>
                </li>
              ) : (
                // Oferta bez strony publicznej (0162): stan + „Usuń z zapisanych”, bez martwego linku.
                <SavedJobUnavailableItem key={job.id} job={job} locationLabel={tj('passport.location')} />
              ),
            )}
          </ul>
        </SavedJobsCompareForm>
      )}
    </div>
  );
}
