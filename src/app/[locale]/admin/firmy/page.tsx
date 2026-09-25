import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { companyFocusKey } from '@/lib/admin/focus';
import { normalizeAdminSearch, parseUuid } from '@/lib/admin/list-params';
import { AWAITING_FILTER, listCompanies } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import {
  filterTabClass,
  INLINE_LINK,
  PANEL,
  ROW,
  ROW_META,
  ROW_TITLE,
  TABLE_WRAP,
  TD,
  TD_WRAP,
  TEXT_LINK,
  TH,
} from '@/components/admin/admin-styles';
import { cn } from '@/lib/utils';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';

/**
 * Panel administratora — Firmy (Etap 7g).
 *
 * Lista firm z filtrem statusu (chipy → query `?status=`); nazwa prowadzi do szczegółu firmy
 * (`/admin/firmy/[id]` — dane, członkowie, oferty, #310) + akcje weryfikacji/odrzucenia/
 * zawieszenia (CompanyStatusActions → dialog potwierdzenia z danymi firmy → RPC
 * `admin_set_company_status`, #310). Filtr `awaiting` = kolejka weryfikacji (`unverified` +
 * `pending`, #307). Wyszukiwanie po nazwie/VAT/KBO/e-mailu i stronicowanie kursorem (#418),
 * parametry w URL (`?status=&q=&cursor=`). Daty w Europe/Brussels (#421). Po zmianie statusu
 * fokus na nagłówku wiersza albo strony (#415). Błąd odczytu → jawny stan błędu (#311). Odczyt service-rolem
 * po potwierdzeniu roli admina w layoucie. NOINDEX + `force-dynamic` (dziedziczone z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/firmy';

/** Filtry statusu: klucz `all` bez query, pozostałe = wartość `company_status`. */
const FILTERS = [
  'all',
  AWAITING_FILTER,
  'unverified',
  'pending',
  'verified',
  'rejected',
  'suspended',
] as const;

/** Etykieta chipa filtra (klucz i18n w namespace `admin`). */
const FILTER_LABEL: Record<string, string> = {
  all: 'filterAll',
  [AWAITING_FILTER]: 'filterAwaiting',
  unverified: 'statusUnverified',
  pending: 'statusPending',
  verified: 'statusVerified',
  rejected: 'statusRejected',
  suspended: 'statusSuspended',
};

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
};

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** Nazwa firmy jako link do szczegółu (#310) — dane, członkowie i oferty przed decyzją. */
function CompanyDetailLink({ id, name }: { id: string; name: string }) {
  return (
    <Link
      href={`/admin/firmy/${encodeURIComponent(id)}`}
      className={cn(INLINE_LINK, 'break-words')}
    >
      {name}
    </Link>
  );
}

/** Skrót do historii statusów firmy w dzienniku zdarzeń (#417) — tylko dla realnych id. */
function CompanyHistoryLink({ id, label }: { id: string; label: string }) {
  const uuid = parseUuid(id);
  if (!uuid) return null;
  return (
    <Link
      href={{ pathname: '/admin/dziennik', query: { entity: 'company', id: uuid } }}
      className={cn(TEXT_LINK, 'px-1 text-xs')}
    >
      {label}
    </Link>
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('companiesTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminCompaniesPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });

  const sp = await searchParams;
  const raw = firstValue(sp['status']);
  const filter =
    raw && (FILTERS as readonly string[]).includes(raw) && raw !== 'all' ? raw : undefined;
  const activeFilter = filter ?? 'all';
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const cursor = firstValue(sp['cursor']) ?? null;

  const result = await listCompanies({ status: filter, q, cursor });
  const companies = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale);
  const listQuery = { status: filter, q };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader
        eyebrow={t('brandTag')}
        title={t('companiesTitle')}
        subtitle={t('companiesSubtitle')}
      />

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('searchCompaniesLabel')}
        hint={t('searchCompaniesHint')}
        keep={{ status: filter }}
        clearHref={{ pathname: BASE_PATH, query: filter ? { status: filter } : {} }}
      />

      {/* Filtry statusu */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((value) => {
          const isActive = value === activeFilter;
          return (
            <Link
              key={value}
              href={{
                pathname: BASE_PATH,
                query: {
                  ...(value === 'all' ? {} : { status: value }),
                  ...(q ? { q } : {}),
                },
              }}
              aria-current={isActive ? 'true' : undefined}
              className={filterTabClass(isActive)}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </div>

      {result.status === 'error' ? (
        <AdminLoadError
          retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`}
        />
      ) : (
        <section className={PANEL}>
          {companies.length === 0 ? (
            <AdminEmptyState message={t('companiesEmpty')} />
          ) : (
            <>
              {/* Desktop: tabela (`.table-wrap table`) */}
              <div className={cn(TABLE_WRAP, 'hidden md:block')}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        {t('colName')}
                      </th>
                      <th scope="col" className={TH}>
                        {t('colStatus')}
                      </th>
                      <th scope="col" className={TH}>
                        {t('colCreated')}
                      </th>
                      <th scope="col" className={cn(TH, 'pr-0 text-right')}>
                        {t('colActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((company) => (
                      <tr key={company.id}>
                        <th
                          scope="row"
                          tabIndex={-1}
                          data-admin-focus={companyFocusKey(company.id)}
                          className={cn(
                            TD_WRAP,
                            'text-left font-normal focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
                          )}
                        >
                          <CompanyDetailLink id={company.id} name={company.name} />
                        </th>
                        <td className={TD}>
                          <AdminStatusBadge kind="company" status={company.status} />
                        </td>
                        <td className={TD}>{formatDate(company.createdAt)}</td>
                        <td className={cn(TD, 'pr-0 text-right')}>
                          <div className="flex flex-wrap items-center justify-end gap-2">
                            <CompanyHistoryLink id={company.id} label={t('auditHistoryLink')} />
                            <CompanyStatusActions
                              company={company}
                              createdLabel={formatDate(company.createdAt)}
                              className="justify-end"
                            />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: wiersze (`.panel .job`) */}
              <ul className="md:hidden">
                {companies.map((company) => (
                  <li key={company.id} className={cn(ROW, 'flex-col')}>
                    <div className="min-w-0">
                      <h2
                        tabIndex={-1}
                        data-admin-focus={companyFocusKey(company.id)}
                        className={cn(
                          ROW_TITLE,
                          'focus:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        )}
                      >
                        <CompanyDetailLink id={company.id} name={company.name} />
                      </h2>
                      <p className={ROW_META}>{formatDate(company.createdAt)}</p>
                      <AdminStatusBadge kind="company" status={company.status} className="mt-1.5" />
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <CompanyStatusActions
                        company={company}
                        createdLabel={formatDate(company.createdAt)}
                      />
                      <CompanyHistoryLink id={company.id} label={t('auditHistoryLink')} />
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {result.status === 'ok' ? (
        <AdminPager
          pathname={BASE_PATH}
          query={listQuery}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={companies.length}
          q={q}
        />
      ) : null}
    </div>
  );
}
