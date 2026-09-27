import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  ADMIN_JOB_FILTERS,
  ADMIN_JOB_FILTER_LABEL,
  ADMIN_JOB_STATUS_KEY,
  parseAdminJobFilter,
} from '@/lib/admin/job-list-params';
import { normalizeAdminSearch, parseUuid } from '@/lib/admin/list-params';
import { listAdminJobs, type AdminJobRow } from '@/lib/data/admin-jobs';
import { createAppDateFormatter } from '@/lib/datetime';
import { isPortalDataConfigured } from '@/lib/db/portal';
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
  TEXT_LINK,
} from '@/components/admin/admin-styles';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableRowHeader,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Oferty (tylko odczyt).
 *
 * Wszystkie oferty wszystkich firm w jednym miejscu (moderacja, odpowiedź na zgłoszenie,
 * pytanie firmy): filtr statusu efektywnego (aktywna po terminie = wygasła, `moderated` =
 * blokada decyzji moderacyjnej), filtr firmy `?firma=<uuid>` (link z `/admin/firmy/[id]`),
 * wyszukiwanie po tytule/slugu/mieście/nazwie firmy/identyfikatorze, stronicowanie kursorem.
 * Tytuł prowadzi do publicznej strony oferty tylko, gdy jest widoczna publicznie; firma — do
 * szczegółu firmy; „Historia” — do dziennika zdarzeń oferty. Bez akcji zapisu (decyzje
 * moderacyjne zapadają w `/admin/zgloszenia`). Odczyt service-rolem po `requireAdmin`
 * (`listAdminJobs`). NOINDEX + `force-dynamic` (dziedziczone z layoutu).
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/oferty';

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
  return { title: t('jobsTitle'), robots: { index: false, follow: false } };
}

export default async function AdminJobsPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });

  const sp = await searchParams;
  const filter = parseAdminJobFilter(firstValue(sp['status']));
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const rawCompany = firstValue(sp['firma']);
  // Filtr firmy = UUID; tylko w trybie demo (bez bazy) identyfikatory firm mają prefiks `demo-`.
  const company = isPortalDataConfigured()
    ? parseUuid(rawCompany)
    : rawCompany && /^demo-c\d+$/.test(rawCompany)
      ? rawCompany
      : null;
  const cursor = firstValue(sp['cursor']) ?? null;

  const result = await listAdminJobs({ status: filter, q, company, cursor });
  const jobs = result.status === 'ok' ? result.rows : [];
  const formatDate = createAppDateFormatter(locale);
  const status = filter === 'all' ? undefined : filter;
  const listQuery = { status, q, firma: company ?? undefined };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();
  const unnamed = t('targetUnnamed');

  const title = (job: AdminJobRow) =>
    job.publicPath ? (
      <Link href={job.publicPath} className={cn(INLINE_LINK, 'break-words')}>
        {job.title || unnamed}
      </Link>
    ) : (
      <span className="break-words">{job.title || unnamed}</span>
    );

  const companyLink = (job: AdminJobRow) => (
    <Link
      href={`/admin/firmy/${encodeURIComponent(job.companyId)}`}
      className={cn(INLINE_LINK, 'break-words')}
    >
      {job.companyName || unnamed}
    </Link>
  );

  const tags = (job: AdminJobRow) => (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="inline-block rounded-[6px] bg-muted px-2 py-[5px] text-[11px] font-medium text-muted-foreground">
        {t(ADMIN_JOB_STATUS_KEY[job.status] ?? 'statusUnknown')}
      </span>
      {job.moderated ? (
        <span className="inline-block rounded-[6px] bg-error/10 px-2 py-[5px] text-[11px] font-medium text-error-text">
          {t('jobsModeratedTag')}
        </span>
      ) : null}
      {job.isDemo ? (
        <span className="inline-block rounded-[6px] bg-muted px-2 py-[5px] text-[11px] font-medium text-muted-foreground">
          {t('jobsDemoTag')}
        </span>
      ) : null}
    </div>
  );

  const historyLink = (job: AdminJobRow) => {
    const uuid = parseUuid(job.id);
    if (!uuid) return null;
    return (
      <Link
        href={{ pathname: '/admin/dziennik', query: { entity: 'job', id: uuid } }}
        aria-label={t('jobsHistoryLabel', { title: job.title || unnamed })}
        className={cn(TEXT_LINK, 'px-1 text-xs')}
      >
        {t('jobsHistoryLink')}
      </Link>
    );
  };

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader
        eyebrow={t('brandTag')}
        title={t('jobsTitle')}
        subtitle={t('jobsSubtitle')}
      />

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('searchJobsLabel')}
        hint={t('searchJobsHint')}
        keep={{ status, firma: company ?? undefined }}
        clearHref={{
          pathname: BASE_PATH,
          query: { ...(status ? { status } : {}), ...(company ? { firma: company } : {}) },
        }}
      />

      {company ? (
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <span>
            {t('jobsCompanyFilter', {
              name:
                result.status === 'ok' && result.company ? result.company.name : t('targetDeleted'),
            })}
          </span>
          <Link
            href={{
              pathname: BASE_PATH,
              query: { ...(status ? { status } : {}), ...(q ? { q } : {}) },
            }}
            className={cn(TEXT_LINK, 'text-sm')}
          >
            {t('jobsCompanyFilterClear')}
          </Link>
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {ADMIN_JOB_FILTERS.map((value) => (
          <Link
            key={value}
            href={{
              pathname: BASE_PATH,
              query: {
                ...(value === 'all' ? {} : { status: value }),
                ...(q ? { q } : {}),
                ...(company ? { firma: company } : {}),
              },
            }}
            aria-current={value === filter ? 'true' : undefined}
            className={filterTabClass(value === filter)}
          >
            {t(ADMIN_JOB_FILTER_LABEL[value])}
          </Link>
        ))}
      </div>

      {result.status === 'error' ? (
        <AdminLoadError
          retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`}
        />
      ) : (
        <section className={PANEL}>
          {jobs.length === 0 ? (
            <AdminEmptyState message={t('jobsListEmpty')} />
          ) : (
            <>
              <div className={cn(TABLE_WRAP, 'hidden md:block')}>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('colJobTitle')}</TableHead>
                      <TableHead>{t('colCompany')}</TableHead>
                      <TableHead>{t('colStatus')}</TableHead>
                      <TableHead>{t('colCreated')}</TableHead>
                      <TableHead className="pr-0 text-right">{t('colActions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {jobs.map((job) => (
                      <TableRow key={job.id}>
                        <TableRowHeader>
                          {title(job)}
                          {job.city ? <span className={cn(ROW_META, 'block')}>{job.city}</span> : null}
                        </TableRowHeader>
                        <TableCell>
                          {companyLink(job)}
                          <AdminStatusBadge kind="company" status={job.companyStatus} className="mt-1.5 block w-fit" />
                        </TableCell>
                        <TableCell>{tags(job)}</TableCell>
                        <TableCell>{formatDate(job.createdAt)}</TableCell>
                        <TableCell className="pr-0 text-right">{historyLink(job)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              <ul className="md:hidden">
                {jobs.map((job) => (
                  <li key={job.id} className={cn(ROW, 'flex-col')}>
                    <div className="min-w-0 space-y-1.5">
                      <h2 className={ROW_TITLE}>{title(job)}</h2>
                      <p className={ROW_META}>
                        {companyLink(job)}
                        {job.city ? ` · ${job.city}` : ''} · {formatDate(job.createdAt)}
                      </p>
                      {tags(job)}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">{historyLink(job)}</div>
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
          count={jobs.length}
          q={q}
        />
      ) : null}
    </div>
  );
}
