import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { campaignFormFromContent } from '@/lib/admin/campaign-editor';
import { campaignSendingReady } from '@/lib/admin/campaigns';
import { getEmailCampaign } from '@/lib/data/admin-campaigns';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { EmailCampaignEditor } from '@/components/admin/EmailCampaignEditor';
import { NOTICE, NOTICE_TEXT, NOTICE_TITLE, TEXT_LINK } from '@/components/admin/admin-styles';

/**
 * Panel administratora — nowa rewizja istniejącej kampanii e-mail (#45). Formularz wstępnie
 * wypełniony treścią wskazanej rewizji; slug stały. Zapis (RPC 0202) tworzy kolejną rewizję
 * jako SZKIC — wskazana rewizja zostaje bez zmian, aktywacja w szczególe nowej rewizji.
 */

export const dynamic = 'force-dynamic';

const BASE_PATH = '/admin/kampanie';

type PageProps = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('campaignNewRevisionTitle'), robots: { index: false, follow: false } };
}

export default async function AdminEmailCampaignRevisionPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const result = await getEmailCampaign(id);

  if (result.status !== 'ok') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <Link href={BASE_PATH} className={TEXT_LINK}>
          <ArrowLeft className="size-4" aria-hidden="true" />
          {t('campaignBack')}
        </Link>
        <AdminPageHeader
          title={result.status === 'not_found' ? t('campaignNotFoundTitle') : t('campaignNewRevisionTitle')}
          subtitle={result.status === 'not_found' ? t('campaignNotFoundHint') : t('campaignSubtitle')}
        />
        {result.status === 'error' ? (
          <AdminLoadError retryHref={`/${locale}${BASE_PATH}/${encodeURIComponent(id)}/nowa-rewizja`} />
        ) : null}
      </div>
    );
  }

  const campaign = result.campaign;
  return (
    <div className="min-w-0 space-y-[22px]">
      <Link href={`${BASE_PATH}/${campaign.id}`} className={TEXT_LINK}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('campaignRevisionLabel', { revision: campaign.revision })}
      </Link>
      <AdminPageHeader
        eyebrow={campaign.slug}
        title={t('campaignNewRevisionTitle')}
        subtitle={t('campaignNewRevisionSubtitle', { revision: campaign.revision })}
      />
      {campaignSendingReady() ? null : (
        <div role="note" className={NOTICE}>
          <div className="min-w-0">
            <strong className={NOTICE_TITLE}>{t('campaignSenderMissingTitle')}</strong>
            <p className={NOTICE_TEXT}>{t('campaignSenderMissingText')}</p>
          </div>
        </div>
      )}
      <EmailCampaignEditor mode="revision" initial={campaignFormFromContent(campaign.slug, campaign.content)} />
    </div>
  );
}
