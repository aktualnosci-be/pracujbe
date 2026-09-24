import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { isLocale, localeNames, routing, type Locale } from '@/i18n/routing';
import { screeningReviewFocusKey } from '@/lib/admin/focus';
import { SCREENING_REVIEW_FILTERS, parseScreeningReviewFilter } from '@/lib/admin/list-params';
import { listScreeningReviews, type AdminScreeningReviewRow } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { localizedText, type LocalizedText } from '@/lib/screening/questions';
import { SCREENING_RISK_CATEGORY_KEY } from '@/lib/screening/review';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader, AdminPager } from '@/components/admin/AdminListControls';
import { ScreeningReviewActions } from '@/components/admin/ScreeningReviewActions';

/**
 * Panel administratora — Przegląd pytań screeningowych (#497).
 *
 * Pytania, które detektor (0103) uznał za mogące dotyczyć danych chronionych albo kryteriów
 * objętych zakazem dyskryminacji. Oferta z takim pytaniem nie zostanie opublikowana, dopóki
 * admin nie zaakceptuje bieżącej treści. Pytanie w każdym języku i każda opcja są widoczne,
 * bo kontrola obejmuje tłumaczenia. Filtr oczekujące/rozstrzygnięte/wszystkie (domyślnie
 * oczekujące, tylko treść nadal obecna w ofercie), stronicowanie kursorem, daty w
 * Europe/Brussels. Decyzja przez `ScreeningReviewActions` (RPC z audytem). Odczyt service-rolem
 * po potwierdzeniu roli admina. NOINDEX + `force-dynamic` (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/pytania';

const FILTER_LABEL: Record<string, string> = {
  pending: 'screeningFilterPending',
  decided: 'screeningFilterDecided',
  all: 'filterAll',
};

const TYPE_LABEL: Record<string, string> = {
  yes_no: 'screeningTypeYesNo',
  single_choice: 'screeningTypeSingleChoice',
  date: 'screeningTypeDate',
  short_text: 'screeningTypeShortText',
};

const STATUS_LABEL: Record<AdminScreeningReviewRow['status'], string> = {
  pending: 'screeningStatusPending',
  approved: 'screeningStatusApproved',
  rejected: 'screeningStatusRejected',
};

const STATUS_CLASS: Record<AdminScreeningReviewRow['status'], string> = {
  pending: 'bg-warning/10 text-warning-text',
  approved: 'bg-success/10 text-success-text',
  rejected: 'bg-error/10 text-error-text',
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Wszystkie niepuste wersje językowe tekstu, w kolejności języków portalu. */
function localizedEntries(text: LocalizedText): [Locale, string][] {
  return routing.locales
    .map((locale): [Locale, string] => [locale, text[locale]?.trim() ?? ''])
    .filter(([, value]) => value.length > 0);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('screeningTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminScreeningReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const tReview = await getTranslations({ locale, namespace: 'screeningReview' });
  const sp = await searchParams;
  const filter = parseScreeningReviewFilter(firstValue(sp['status']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === 'pending' ? null : filter;

  const result = await listScreeningReviews({ status: filter, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const listQuery = { status: statusQuery };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const viewLocale = isLocale(locale) ? locale : routing.defaultLocale;

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('screeningTitle')} subtitle={t('screeningSubtitle')} />

      <nav aria-label={t('screeningFilterLabel')} className="flex flex-wrap gap-2">
        {SCREENING_REVIEW_FILTERS.map((value) => {
          const isActive = value === filter;
          const query: Record<string, string> = value === 'pending' ? {} : { status: value };
          return (
            <Link
              key={value}
              href={{ pathname: BASE_PATH, query }}
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'inline-flex min-h-11 items-center rounded-full border px-3 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
              )}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </nav>

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('screeningEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const categories = row.categories
                  .map((category) => tReview(SCREENING_RISK_CATEGORY_KEY[category]))
                  .join(', ');
                const promptLabel = localizedText(row.prompt, viewLocale);
                const actionable = row.status === 'pending' && row.current;
                return (
                  <li key={row.id} className="p-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              STATUS_CLASS[row.status],
                            )}
                          >
                            {t(STATUS_LABEL[row.status])}
                          </span>
                          {!row.current ? (
                            <span className="inline-flex items-center rounded-full bg-soft px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                              {t('screeningNotCurrent')}
                            </span>
                          ) : null}
                          <span className="text-xs font-medium text-muted-foreground">
                            {t('screeningCategories', { categories })}
                          </span>
                        </div>
                        <h2
                          tabIndex={-1}
                          data-admin-focus={screeningReviewFocusKey(row.id)}
                          className="break-words text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {promptLabel}
                        </h2>
                        <p className="break-words text-xs text-muted-foreground">
                          {row.companyId ? (
                            <Link
                              href={{ pathname: `/admin/firmy/${row.companyId}` }}
                              className="font-medium text-foreground underline underline-offset-2"
                            >
                              {row.companyName || t('screeningUnknownCompany')}
                            </Link>
                          ) : (
                            t('screeningUnknownCompany')
                          )}
                          {' · '}
                          {row.jobTitle || t('screeningUnknownJob')}
                          {' · '}
                          {t(TYPE_LABEL[row.questionType] ?? 'screeningTypeShortText')}
                        </p>
                        <dl className="space-y-1 text-sm">
                          {localizedEntries(row.prompt).map(([lang, text]) => (
                            <div key={lang} className="flex min-w-0 flex-wrap gap-x-2">
                              <dt className="text-muted-foreground">{localeNames[lang]}:</dt>
                              <dd className="min-w-0 break-words text-foreground">{text}</dd>
                            </div>
                          ))}
                        </dl>
                        {row.options.length > 0 ? (
                          <div className="space-y-1 text-sm">
                            <p className="text-xs font-medium text-muted-foreground">
                              {t('screeningOptions')}
                            </p>
                            <ol className="list-inside list-decimal space-y-1">
                              {row.options.map((option, index) => (
                                <li key={index} className="break-words text-foreground">
                                  {localizedEntries(option.label)
                                    .map(([lang, text]) => `${localeNames[lang]}: ${text}`)
                                    .join(' · ')}
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}
                        <p className="text-xs text-muted-foreground">
                          {t('screeningRequestedBy', {
                            name: row.requestedByName ?? t('auditActorSystem'),
                          })}{' '}
                          <time dateTime={row.createdAt ?? undefined}>{formatDate(row.createdAt)}</time>
                        </p>
                        {row.status !== 'pending' ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {t('screeningDecidedBy', {
                                name: row.decidedByName ?? t('adminName'),
                              })}{' '}
                              <time dateTime={row.decidedAt ?? undefined}>
                                {formatDate(row.decidedAt)}
                              </time>
                            </p>
                            {row.reason ? (
                              <p className="break-words text-sm text-muted-foreground">
                                {t('screeningDecisionReason', { text: row.reason })}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      {actionable ? (
                        <ScreeningReviewActions
                          id={row.id}
                          promptLabel={promptLabel}
                          categoriesLabel={categories}
                        />
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}
      {result.status === 'ok' ? (
        <AdminPager
          pathname={BASE_PATH}
          query={listQuery}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={rows.length}
          q={null}
        />
      ) : null}
    </div>
  );
}
