import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import {
  CAMPAIGN_FILTERS,
  CAMPAIGN_RECIPIENT_KEY,
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_STATUS_KEY,
  campaignSendingReady,
  parseCampaignFilter,
} from '@/lib/admin/campaigns';
import { emailCampaignFocusKey } from '@/lib/admin/focus';
import { normalizeAdminSearch } from '@/lib/admin/list-params';
import { listEmailCampaigns } from '@/lib/data/admin-campaigns';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import {
  chipClass,
  INLINE_LINK,
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
  PANEL,
  ROW,
  ROW_META,
  ROW_TITLE,
  STATUS,
  TAG,
} from '@/components/admin/admin-styles';

/**
 * Panel administratora — kampanie e-mail (#45).
 *
 * Rewizje `email_campaigns` (najnowsze pierwsze) z liczbami odbiorców według statusu
 * (`email_campaign_recipients` — same liczby, bez adresów). Filtr statusu, wyszukiwanie po
 * slugu, stronicowanie kursorem. Aktywacja i zatrzymanie — w szczególe rewizji (podgląd treści
 * w każdym języku przed decyzją). Bez konfiguracji nadawcy marketingu jawny komunikat.
 * NOINDEX + `force-dynamic`.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/kampanie';

const FILTER_LABEL: Record<string, string> = {
  all: 'filterAll',
  draft: 'campaignStatusDraft',
  active: 'campaignStatusActive',
  closed: 'campaignFilterClosed',
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
  return { title: t('campaignTitle'), robots: { index: false, follow: false } };
}

export default async function AdminEmailCampaignsPage({
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
  const filter = parseCampaignFilter(firstValue(sp['status']));
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const cursor = firstValue(sp['cursor']) ?? null;
  const statusQuery = filter === 'all' ? null : filter;

  const result = await listEmailCampaigns({ status: filter, q, cursor });
  const rows = result.status === 'ok' ? result.rows : [];
  const sendingReady = campaignSendingReady();
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const listQuery = { status: statusQuery, q };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  return (
    <div className="min-w-0 space-y-[22px]">
      <AdminPageHeader title={t('campaignTitle')} subtitle={t('campaignSubtitle')} />

      {sendingReady ? null : (
        <div role="note" className={NOTICE}>
          <div className="min-w-0">
            <strong className={NOTICE_TITLE}>{t('campaignSenderMissingTitle')}</strong>
            <p className={NOTICE_TEXT}>{t('campaignSenderMissingText')}</p>
          </div>
        </div>
      )}

      <nav aria-label={t('campaignFilterLabel')} className="flex flex-wrap gap-2">
        {CAMPAIGN_FILTERS.map((value) => {
          const query: Record<string, string> = {};
          if (value !== 'all') query['status'] = value;
          if (q) query['q'] = q;
          return (
            <Link
              key={value}
              href={{ pathname: BASE_PATH, query }}
              aria-current={value === filter ? 'true' : undefined}
              className={chipClass(value === filter)}
            >
              {t(FILTER_LABEL[value] ?? 'filterAll')}
            </Link>
          );
        })}
      </nav>

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('campaignSearchLabel')}
        hint={t('campaignSearchHint')}
        keep={{ status: statusQuery }}
        clearHref={{ pathname: BASE_PATH, query: statusQuery ? { status: statusQuery } : {} }}
      />

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section aria-label={t('campaignTitle')} className={PANEL}>
          {rows.length === 0 ? (
            <AdminEmptyState message={t('campaignEmpty')} />
          ) : (
            <ul className="min-w-0">
              {rows.map((row) => (
                <li key={row.id} className={ROW}>
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={TAG}>{t('campaignRevisionLabel', { revision: row.revision })}</span>
                      <span className={STATUS}>{t(CAMPAIGN_STATUS_KEY[row.status])}</span>
                    </div>
                    <h2
                      tabIndex={-1}
                      data-admin-focus={emailCampaignFocusKey(row.id)}
                      className={`${ROW_TITLE} focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
                    >
                      <Link href={`${BASE_PATH}/${row.id}`} className={INLINE_LINK}>
                        {row.slug}
                      </Link>
                    </h2>
                    <p className={ROW_META}>
                      {t('campaignCreatedAt')}{' '}
                      <time dateTime={row.createdAt ?? undefined}>{formatDate(row.createdAt)}</time>
                      {row.activatedAt ? (
                        <>
                          {' · '}
                          {t('campaignActivatedAt')}{' '}
                          <time dateTime={row.activatedAt}>{formatDate(row.activatedAt)}</time>
                        </>
                      ) : null}
                    </p>
                    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <div className="flex gap-1">
                        <dt>{t('campaignRecipientTotal')}:</dt>
                        <dd className="font-semibold text-foreground">{row.recipients.total}</dd>
                      </div>
                      {CAMPAIGN_RECIPIENT_STATUSES.filter((s) => row.recipients[s] > 0).map((s) => (
                        <div key={s} className="flex gap-1">
                          <dt>{t(CAMPAIGN_RECIPIENT_KEY[s])}:</dt>
                          <dd className="font-semibold text-foreground">{row.recipients[s]}</dd>
                        </div>
                      ))}
                    </dl>
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
    </div>
  );
}
