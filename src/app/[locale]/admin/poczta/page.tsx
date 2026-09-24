import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { emailSuppressionFocusKey } from '@/lib/admin/focus';
import {
  EMAIL_SUPPRESSION_FILTERS,
  EMAIL_SUPPRESSION_REASON_KEY,
  normalizeAdminSearch,
  parseEmailSuppressionFilter,
} from '@/lib/admin/list-params';
import { listEmailSuppressions } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import { EmailSuppressionActions } from '@/components/admin/EmailSuppressionActions';

/**
 * Panel administratora — Blokady adresów e-mail (#44).
 *
 * Adresy, na które portal nie wysyła powiadomień z kolejki po trwałym odbiciu albo skardze
 * (webhook dostawcy → `record_email_event`, 0099). Filtr aktywne/zdjęte/wszystkie (domyślnie
 * aktywne), wyszukiwanie po adresie, stronicowanie kursorem, daty w Europe/Brussels. Zdjęcie
 * blokady z uzasadnieniem przez `EmailSuppressionActions` (RPC z audytem). Odczyt service-rolem
 * po potwierdzeniu roli admina. NOINDEX + `force-dynamic` (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/poczta';

const FILTER_LABEL: Record<string, string> = {
  active: 'emailFilterActive',
  lifted: 'emailFilterLifted',
  all: 'filterAll',
};

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('emailTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminEmailSuppressionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const sp = await searchParams;
  const filter = parseEmailSuppressionFilter(firstValue(sp['status']));
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === 'active' ? null : filter;

  const result = await listEmailSuppressions({ status: filter, q, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const listQuery = { status: statusQuery, q };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  const reasonLabel = (reason: string): string =>
    t(EMAIL_SUPPRESSION_REASON_KEY[reason] ?? 'statusUnknown');

  return (
    <div className="space-y-6">
      <AdminPageHeader title={t('emailTitle')} subtitle={t('emailSubtitle')} />

      <nav aria-label={t('emailFilterLabel')} className="flex flex-wrap gap-2">
        {EMAIL_SUPPRESSION_FILTERS.map((value) => {
          const isActive = value === filter;
          const query: Record<string, string> = {};
          if (value !== 'active') query['status'] = value;
          if (q) query['q'] = q;
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

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('emailSearchLabel')}
        hint={t('emailSearchHint')}
        keep={{ status: statusQuery }}
        clearHref={{ pathname: BASE_PATH, query: statusQuery ? { status: statusQuery } : {} }}
      />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {rows.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('emailEmpty')}</p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map((row) => {
                const label = reasonLabel(row.reason);
                const created = formatDate(row.createdAt);
                const lifted = row.liftedAt !== null;
                return (
                  <li key={row.id} className="p-4 sm:px-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              lifted
                                ? 'bg-soft text-muted-foreground'
                                : 'bg-warning/10 text-warning-text',
                            )}
                          >
                            {lifted ? t('emailStatusLifted') : t('emailStatusActive')}
                          </span>
                          <span className="text-xs font-medium text-muted-foreground">{label}</span>
                        </div>
                        <h2
                          tabIndex={-1}
                          data-admin-focus={emailSuppressionFocusKey(row.id)}
                          className="break-all text-sm font-semibold text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          {row.email}
                        </h2>
                        <p className="text-xs text-muted-foreground">
                          {t('emailBlockedAt')}{' '}
                          <time dateTime={row.createdAt ?? undefined}>{created}</time>
                        </p>
                        {lifted ? (
                          <>
                            <p className="text-xs text-muted-foreground">
                              {t('emailLiftedBy', {
                                name: row.liftedByName ?? t('adminName'),
                              })}{' '}
                              <time dateTime={row.liftedAt ?? undefined}>
                                {formatDate(row.liftedAt)}
                              </time>
                            </p>
                            {row.liftReason ? (
                              <p className="break-words text-sm text-muted-foreground">
                                {t('emailLiftReason', { text: row.liftReason })}
                              </p>
                            ) : null}
                          </>
                        ) : null}
                      </div>
                      {lifted ? null : (
                        <EmailSuppressionActions
                          id={row.id}
                          email={row.email}
                          reasonLabel={label}
                          createdLabel={created}
                        />
                      )}
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
          q={q}
        />
      ) : null}
    </div>
  );
}
