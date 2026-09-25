import type { Metadata } from 'next';
import { Plus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  BREACH_KIND_KEY,
  BREACH_RISK_KEY,
  type BreachKind,
  type BreachRiskLevel,
} from '@/lib/admin/breach';
import { BREACH_LIST_FILTERS, normalizeAdminSearch, parseBreachFilter } from '@/lib/admin/list-params';
import { listBreachIncidents } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { cn } from '@/lib/utils';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import { BreachDeadlineBadge } from '@/components/admin/BreachDeadlineBadge';
import {
  BTN_PRIMARY,
  filterTabClass,
  INLINE_LINK,
  PANEL,
  ROW,
  ROW_META,
  ROW_TITLE,
  STATUS,
  TAG,
} from '@/components/admin/admin-styles';

/**
 * Panel administratora — rejestr incydentów i naruszeń danych osobowych (#490).
 *
 * Każdy incydent bezpieczeństwa i każde naruszenie danych osobowych (także niezgłaszane do
 * organu) ma tu wpis: rodzaj, czas stwierdzenia, stan terminu 72 h, ocena ryzyka. Filtr
 * otwarte/zamknięte/wszystkie, wyszukiwanie po numerze i tytule, stronicowanie kursorem.
 * Odczyt service-rolem po potwierdzeniu roli admina; zapis przez RPC z audytem (0106).
 * NOINDEX + `force-dynamic` (z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/naruszenia';

const FILTER_LABEL: Record<string, string> = {
  open: 'breachFilterOpen',
  closed: 'breachFilterClosed',
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
  return { title: t('breachTitle'), robots: { index: false, follow: false } };
}

export default async function AdminBreachesPage({
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
  const filter = parseBreachFilter(firstValue(sp['status']));
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === 'open' ? null : filter;

  const result = await listBreachIncidents({ status: filter, q, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const now = Date.now();
  const listQuery = { status: statusQuery, q };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader title={t('breachTitle')} subtitle={t('breachSubtitle')} />
      <div>
        <Link href={`${BASE_PATH}/nowy`} className={BTN_PRIMARY}>
          <Plus className="size-4" aria-hidden="true" />
          {t('breachNew')}
        </Link>
      </div>

      <nav aria-label={t('breachFilterLabel')} className="flex flex-wrap gap-2">
        {BREACH_LIST_FILTERS.map((value) => {
          const query: Record<string, string> = {};
          if (value !== 'open') query['status'] = value;
          if (q) query['q'] = q;
          return (
            <Link
              key={value}
              href={{ pathname: BASE_PATH, query }}
              aria-current={value === filter ? 'true' : undefined}
              className={filterTabClass(value === filter)}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </nav>

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('breachSearchLabel')}
        hint={t('breachSearchHint')}
        keep={{ status: statusQuery }}
        clearHref={{ pathname: BASE_PATH, query: statusQuery ? { status: statusQuery } : {} }}
      />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section aria-label={t('breachTitle')} className={PANEL}>
          {rows.length === 0 ? (
            <AdminEmptyState message={t('breachEmpty')} />
          ) : (
            <ul className="min-w-0">
              {rows.map((row) => (
                <li key={row.id} className={ROW}>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={TAG}>{row.reference}</span>
                      <span className={TAG}>{t(BREACH_KIND_KEY[row.kind as BreachKind] ?? 'statusUnknown')}</span>
                      <span className={STATUS}>
                        {row.status === 'closed' ? t('breachStatusClosed') : t('breachStatusOpen')}
                      </span>
                      <BreachDeadlineBadge incident={row} now={now} />
                    </div>
                    <h2 className={ROW_TITLE}>
                      <Link href={`${BASE_PATH}/${row.id}`} className={INLINE_LINK}>
                        {row.title}
                      </Link>
                    </h2>
                    <p className={ROW_META}>
                      {t('breachDetectedLabel')}{' '}
                      <time dateTime={row.detectedAt ?? undefined}>{formatDate(row.detectedAt)}</time>
                      {' · '}
                      {t('breachFieldRiskLevel')}:{' '}
                      {t(BREACH_RISK_KEY[row.riskLevel as BreachRiskLevel] ?? 'statusUnknown')}
                    </p>
                  </div>
                </li>
              ))}
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
      <p className={cn(ROW_META, 'max-w-2xl')}>{t('breachDataMinimisation')}</p>
    </div>
  );
}
