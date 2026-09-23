import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { ADMIN_MAX_ROWS, AWAITING_FILTER, listCompanies } from '@/lib/data/admin';
import { AdminLoadError, AdminTruncatedNote } from '@/components/admin/AdminLoadError';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Firmy (Etap 7g).
 *
 * Lista firm z filtrem statusu (chipy → query `?status=`) + akcje weryfikacji/odrzucenia/
 * zawieszenia (CompanyStatusActions → dialog potwierdzenia z danymi firmy → RPC
 * `admin_set_company_status`, #310). Filtr `awaiting` = kolejka weryfikacji (`unverified` +
 * `pending`, #307). Błąd odczytu → jawny stan błędu (#311). Odczyt service-rolem
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

  const result = await listCompanies(filter);
  const companies = result.status === 'ok' ? result.rows : [];
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const formatDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—');

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('companiesTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('companiesSubtitle')}</p>
      </header>

      {/* Filtry statusu */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((value) => {
          const isActive = value === activeFilter;
          return (
            <Link
              key={value}
              href={
                value === 'all'
                  ? { pathname: BASE_PATH }
                  : { pathname: BASE_PATH, query: { status: value } }
              }
              aria-current={isActive ? 'true' : undefined}
              className={cn(
                'inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium transition-colors',
                isActive
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-muted-foreground hover:bg-soft hover:text-foreground',
              )}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </div>

      {result.status === 'error' ? (
        <AdminLoadError
          retryHref={`/${locale}${BASE_PATH}${filter ? `?status=${encodeURIComponent(filter)}` : ''}`}
        />
      ) : (
        <section className="rounded-lg border border-border bg-card">
          {companies.length === 0 ? (
            <p className="p-6 text-center text-sm text-muted-foreground">{t('companiesEmpty')}</p>
          ) : (
            <>
              {/* Desktop: tabela */}
              <div className="hidden overflow-x-auto md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                        {t('colName')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                        {t('colStatus')}
                      </th>
                      <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                        {t('colCreated')}
                      </th>
                      <th
                        scope="col"
                        className="px-4 py-3 text-right font-medium text-muted-foreground"
                      >
                        {t('colActions')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {companies.map((company) => (
                      <tr key={company.id}>
                        <td className="px-4 py-3 align-middle font-medium text-foreground">
                          {company.name}
                        </td>
                        <td className="px-4 py-3 align-middle">
                          <AdminStatusBadge kind="company" status={company.status} />
                        </td>
                        <td className="px-4 py-3 align-middle text-muted-foreground">
                          {formatDate(company.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right align-middle">
                          <CompanyStatusActions
                            company={company}
                            createdLabel={formatDate(company.createdAt)}
                            className="justify-end"
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: karty */}
              <ul className="divide-y divide-border md:hidden">
                {companies.map((company) => (
                  <li key={company.id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">{company.name}</p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatDate(company.createdAt)}
                        </p>
                      </div>
                      <AdminStatusBadge kind="company" status={company.status} />
                    </div>
                    <CompanyStatusActions
                      company={company}
                      createdLabel={formatDate(company.createdAt)}
                    />
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}
      {result.status === 'ok' && result.truncated ? (
        <AdminTruncatedNote limit={ADMIN_MAX_ROWS} />
      ) : null}
    </div>
  );
}
