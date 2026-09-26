import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { emptyCampaignForm } from '@/lib/admin/campaign-editor';
import { campaignSendingReady } from '@/lib/admin/campaigns';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { EmailCampaignEditor } from '@/components/admin/EmailCampaignEditor';
import { NOTICE, NOTICE_TEXT, NOTICE_TITLE, TEXT_LINK } from '@/components/admin/admin-styles';

/**
 * Panel administratora — nowa kampania e-mail (#45): slug + treść w każdym języku serwisu.
 * Zapis (`createEmailCampaignRevision`, RPC 0202) tworzy SZKIC rewizji 1; aktywacja w szczególe.
 * Bez konfiguracji nadawcy marketingu — ten sam komunikat co na liście (szkic można zapisać).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return { title: t('campaignNewTitle'), robots: { index: false, follow: false } };
}

export default async function AdminEmailCampaignNewPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  return (
    <div className="min-w-0 space-y-[22px]">
      <Link href="/admin/kampanie" className={TEXT_LINK}>
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t('campaignBack')}
      </Link>
      <AdminPageHeader title={t('campaignNewTitle')} subtitle={t('campaignNewSubtitle')} />
      {campaignSendingReady() ? null : (
        <div role="note" className={NOTICE}>
          <div className="min-w-0">
            <strong className={NOTICE_TITLE}>{t('campaignSenderMissingTitle')}</strong>
            <p className={NOTICE_TEXT}>{t('campaignSenderMissingText')}</p>
          </div>
        </div>
      )}
      <EmailCampaignEditor mode="new" initial={emptyCampaignForm()} />
    </div>
  );
}
