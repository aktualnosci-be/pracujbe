import type { Metadata } from 'next';
import { Scale } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminEmptyState, AdminPageHeader } from '@/components/admin/AdminListControls';
import { AppealDecisionActions } from '@/components/admin/AppealDecisionActions';
import {
  ICON_BOX,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  TAG,
} from '@/components/admin/admin-styles';
import { appealFocusKey } from '@/lib/admin/focus';
import { reportReasonView } from '@/lib/admin/list-params';
import { listAppeals, type AdminAppealRow } from '@/lib/data/admin-dsa';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Odwołania od decyzji moderacyjnych (DSA, #43).
 *
 * Oczekujące odwołania według terminu rozpatrzenia (po terminie — oznaczone), z uzasadnieniem
 * strony, decyzją, której dotyczą, i dialogiem rozpatrzenia (`AppealDecisionActions`). Autor
 * decyzji widzi informację, że odwołanie rozpatruje inny administrator. Poniżej 20 ostatnio
 * rozpatrzonych z wynikiem i uzasadnieniem. Odczyt service-rolem po potwierdzeniu roli admina.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/odwolania';

const STATUS_KEY: Record<string, string> = {
  pending: 'appealStatusPending',
  upheld: 'appealStatusUpheld',
  reversed: 'appealStatusReversed',
};

const DECISION_LABEL: Record<string, string> = {
  no_action: 'decisionNoAction',
  job_removed: 'decisionJobRemoved',
  company_suspended: 'decisionCompanySuspended',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('appealsTitle'), robots: { index: false, follow: false } };
}

export default async function AdminAppealsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const result = await listAppeals();
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  // Termin liczony w chwili renderu (strona force-dynamic).
  const now = Date.now();

  const renderRow = (appeal: AdminAppealRow) => {
    const overdue = appeal.status === 'pending' && Date.parse(appeal.dueAt) < now;
    return (
      <li key={appeal.id} className={ROW}>
        <span className={ICON_BOX} aria-hidden="true">
          <Scale />
        </span>
        <div className="flex min-w-0 flex-1 flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64 space-y-1.5">
            <h3
              tabIndex={-1}
              data-admin-focus={appealFocusKey(appeal.id)}
              className={cn(ROW_TITLE, 'mb-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring')}
            >
              {appeal.reference}
            </h3>
            <div className="flex flex-wrap gap-1.5">
              <span className={TAG}>{t(appeal.role === 'author' ? 'appealRoleAuthor' : 'appealRoleReporter')}</span>
              {appeal.restoration ? <span className={TAG}>{t('appealTargetRestoration')}</span> : null}
              <span className={TAG}>{t(STATUS_KEY[appeal.status] ?? 'appealStatusPending')}</span>
              {overdue ? (
                <span className={cn(TAG, 'bg-error/10 text-error-text')}>{t('appealOverdue')}</span>
              ) : null}
            </div>
            <p className={ROW_META}>
              {t('appealSubmittedAt', { date: formatDate(appeal.submittedAt) })}
              {' · '}
              {appeal.status === 'pending'
                ? t('appealDueAt', { date: formatDate(appeal.dueAt) })
                : t('appealDecidedAt', { date: formatDate(appeal.decidedAt ?? appeal.submittedAt) })}
            </p>
            <p className={ROW_META}>
              {t('appealCase', { caseNumber: appeal.report.caseNumber })}
              {appeal.report.category ? ` · ${t(reportReasonView(appeal.report.category).key)}` : ''}
            </p>
            <div className="space-y-1 rounded-[14px] border border-border px-4 py-3 text-[13px]">
              <p className="font-medium text-foreground">
                {t('decisionSummaryTitle', { reference: appeal.decision.reference })}
                {': '}
                {t(DECISION_LABEL[appeal.decision.decision] ?? 'decisionNoAction')}
              </p>
              {appeal.decision.facts ? (
                <p className="break-words text-foreground">{appeal.decision.facts}</p>
              ) : null}
              {appeal.restoration ? (
                <p className="break-words text-foreground">
                  {t('appealRestorationSummary', {
                    date: formatDate(appeal.restoration.restoredAt),
                    reason: appeal.restoration.reason ?? '—',
                  })}
                </p>
              ) : null}
            </div>
            {appeal.grounds ? (
              <blockquote className="break-words rounded-[14px] border border-border bg-soft px-4 py-3 text-[13px] text-foreground">
                <span className="block text-xs text-muted-foreground">{t('appealGrounds')}</span>
                {appeal.grounds}
              </blockquote>
            ) : null}
            {appeal.reasoning ? (
              <p className="break-words text-[13px] text-foreground">
                <span className="text-muted-foreground">{t('appealReasoningLabel')}: </span>
                {appeal.reasoning}
              </p>
            ) : null}
            {appeal.sameReviewer ? <p className={ROW_META}>{t('appealSameReviewer')}</p> : null}
          </div>
          {appeal.status === 'pending' ? (
            <AppealDecisionActions
              appealId={appeal.id}
              reference={appeal.reference}
              role={appeal.role}
              targetType={appeal.report.targetType}
              decisionReference={appeal.decision.reference}
              reviewerConflict={appeal.reviewerConflict}
            />
          ) : null}
        </div>
      </li>
    );
  };

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader eyebrow={t('brandTag')} title={t('appealsTitle')} subtitle={t('appealsSubtitle')} />
      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}`} />
      ) : (
        <>
          <section className={PANEL} aria-labelledby="appeals-pending-title">
            <div className={SECTION_HEAD}>
              <h2 id="appeals-pending-title" className={PANEL_H2}>
                {t('appealsPending')}
              </h2>
            </div>
            {result.pending.length === 0 ? (
              <AdminEmptyState message={t('appealsEmpty')} />
            ) : (
              <ul>{result.pending.map(renderRow)}</ul>
            )}
          </section>
          <section className={PANEL} aria-labelledby="appeals-decided-title">
            <div className={SECTION_HEAD}>
              <h2 id="appeals-decided-title" className={PANEL_H2}>
                {t('appealsDecided')}
              </h2>
            </div>
            {result.decided.length === 0 ? (
              <AdminEmptyState message={t('appealsDecidedEmpty')} />
            ) : (
              <ul>{result.decided.map(renderRow)}</ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
