import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { localeNames } from '@/i18n/routing';
import {
  CAMPAIGN_RECIPIENT_KEY,
  CAMPAIGN_RECIPIENT_STATUSES,
  CAMPAIGN_STATUS_KEY,
  campaignPreview,
  campaignSendingReady,
  canActivateCampaign,
  canCancelCampaign,
} from '@/lib/admin/campaigns';
import { emailCampaignFocusKey } from '@/lib/admin/focus';
import { getEmailCampaign } from '@/lib/data/admin-campaigns';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { EmailCampaignActions } from '@/components/admin/EmailCampaignActions';
import {
  INLINE_LINK,
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  STATUS,
  TAG,
  TEXT_LINK,
} from '@/components/admin/admin-styles';

/**
 * Panel administratora — rewizja kampanii e-mail (#45).
 *
 * Stan rewizji, liczby odbiorców według statusu (bez adresów), podgląd treści w KAŻDYM języku
 * serwisu (list idzie w języku odbiorcy — Invariant #1; „niepoprawna treść” = worker jej nie
 * wyrenderuje), rewizje tego sluga oraz aktywacja/zatrzymanie (`EmailCampaignActions`, RPC
 * z CAS i audytem, 0111). Bez konfiguracji nadawcy marketingu — komunikat i brak aktywacji.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/kampanie';
const SENDER_NOTICE_ID = 'campaign-sender-missing';

type PageProps = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('campaignTitle'), robots: { index: false, follow: false } };
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href={BASE_PATH} className={TEXT_LINK}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

export default async function AdminEmailCampaignPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const formatDate = createAppDateFormatter(locale, { withTime: true });
  const result = await getEmailCampaign(id);

  if (result.status !== 'ok') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <BackLink label={t('campaignBack')} />
        <AdminPageHeader
          title={result.status === 'not_found' ? t('campaignNotFoundTitle') : t('campaignTitle')}
          subtitle={result.status === 'not_found' ? t('campaignNotFoundHint') : t('campaignSubtitle')}
        />
        {result.status === 'error' ? (
          <AdminLoadError retryHref={`/${locale}${BASE_PATH}/${encodeURIComponent(id)}`} />
        ) : null}
      </div>
    );
  }

  const campaign = result.campaign;
  const statusLabel = t(CAMPAIGN_STATUS_KEY[campaign.status]);
  const sendingReady = campaignSendingReady();
  const preview = campaignPreview(campaign.content);
  const canActivate = canActivateCampaign(campaign.status);
  const canCancel = canCancelCampaign(campaign.status);

  return (
    <div className="min-w-0 space-y-[22px]">
      <BackLink label={t('campaignBack')} />
      <AdminPageHeader
        eyebrow={t('campaignRevisionLabel', { revision: campaign.revision })}
        title={campaign.slug}
        subtitle={t('campaignDetailSubtitle')}
      />

      {sendingReady ? null : (
        <div id={SENDER_NOTICE_ID} role="note" className={NOTICE}>
          <div className="min-w-0">
            <strong className={NOTICE_TITLE}>{t('campaignSenderMissingTitle')}</strong>
            <p className={NOTICE_TEXT}>{t('campaignSenderMissingText')}</p>
          </div>
        </div>
      )}

      <section aria-labelledby="campaign-state-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2
            id="campaign-state-heading"
            tabIndex={-1}
            data-admin-focus={emailCampaignFocusKey(campaign.id)}
            className={`${PANEL_H2} focus:outline-none focus-visible:ring-2 focus-visible:ring-ring`}
          >
            {t('campaignSectionState')}
          </h2>
          <span className={STATUS}>{statusLabel}</span>
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-3">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('campaignCreatedAt')}</dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-foreground">{formatDate(campaign.createdAt)}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('campaignActivatedAt')}</dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-foreground">
              {campaign.activatedAt ? formatDate(campaign.activatedAt) : '—'}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('campaignClosedAt')}</dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-foreground">
              {campaign.closedAt ? formatDate(campaign.closedAt) : '—'}
            </dd>
          </div>
        </dl>
        {canActivate || canCancel ? (
          <div className="mt-6 space-y-3 border-t border-border pt-5">
            <p className={PANEL_P}>{t('campaignActionsHint')}</p>
            <EmailCampaignActions
              id={campaign.id}
              slug={campaign.slug}
              revision={campaign.revision}
              status={campaign.status}
              statusLabel={statusLabel}
              canActivate={canActivate}
              canCancel={canCancel}
              sendingReady={sendingReady}
              senderNoticeId={SENDER_NOTICE_ID}
            />
          </div>
        ) : null}
      </section>

      <section aria-labelledby="campaign-recipients-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="campaign-recipients-heading" className={PANEL_H2}>
            {t('campaignSectionRecipients')}
          </h2>
        </div>
        <p className={PANEL_P}>{t('campaignRecipientsHint')}</p>
        <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="min-w-0">
            <dt className="text-xs text-muted-foreground">{t('campaignRecipientTotal')}</dt>
            <dd className="mt-1.5 text-[15px] font-semibold text-foreground">{campaign.recipients.total}</dd>
          </div>
          {CAMPAIGN_RECIPIENT_STATUSES.map((s) => (
            <div key={s} className="min-w-0">
              <dt className="break-words text-xs text-muted-foreground">{t(CAMPAIGN_RECIPIENT_KEY[s])}</dt>
              <dd className="mt-1.5 text-[15px] font-semibold text-foreground">{campaign.recipients[s]}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="campaign-preview-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="campaign-preview-heading" className={PANEL_H2}>
            {t('campaignSectionPreview')}
          </h2>
        </div>
        <p className={PANEL_P}>{t('campaignPreviewHint')}</p>
        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
          {preview.map((entry) => (
            <section
              key={entry.locale}
              aria-labelledby={`campaign-preview-${entry.locale}`}
              className="min-w-0 rounded-[14px] border border-border p-4"
            >
              <h3 id={`campaign-preview-${entry.locale}`} className="text-sm font-semibold text-foreground">
                {localeNames[entry.locale]}
              </h3>
              {entry.status === 'invalid' ? (
                <p className="mt-2 text-sm font-medium text-error-text">{t('campaignPreviewInvalid')}</p>
              ) : (
                <ul lang={entry.locale} className="mt-2 space-y-2">
                  {entry.jobs.map((job) => (
                    <li key={job.slug} className="min-w-0">
                      <p className="break-words text-sm font-semibold text-foreground">{job.title}</p>
                      <p className={ROW_META}>
                        {job.city}
                        {job.salary ? ` · ${job.salary}` : ''}
                      </p>
                      <p className={`${ROW_META} break-all`}>
                        {job.slug}
                        {job.isDemo ? (
                          <span className={`${TAG} ml-2`}>{t('campaignPreviewDemo')}</span>
                        ) : null}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      </section>

      <section aria-labelledby="campaign-revisions-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="campaign-revisions-heading" className={PANEL_H2}>
            {t('campaignSectionRevisions')}
          </h2>
        </div>
        <ul className="min-w-0">
          {campaign.revisions.map((rev) => (
            <li key={rev.id} className={ROW}>
              <div className="min-w-0 flex-1">
                <p className={ROW_TITLE}>
                  {rev.id === campaign.id ? (
                    <span aria-current="page">{t('campaignRevisionLabel', { revision: rev.revision })}</span>
                  ) : (
                    <Link href={`${BASE_PATH}/${rev.id}`} className={INLINE_LINK}>
                      {t('campaignRevisionLabel', { revision: rev.revision })}
                    </Link>
                  )}
                </p>
                <p className={ROW_META}>
                  {t(CAMPAIGN_STATUS_KEY[rev.status])} ·{' '}
                  <time dateTime={rev.createdAt ?? undefined}>{formatDate(rev.createdAt)}</time>
                </p>
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
