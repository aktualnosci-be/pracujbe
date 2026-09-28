import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getMessageTemplatesPage } from '@/lib/data/message-templates';
import { MessageTemplatesManager } from '@/components/employer/MessageTemplatesManager';
import { RecruiterOnlyNote } from '@/components/employer/RecruiterOnlyNote';
import { BTN_SECONDARY, EYEBROW, H1_EXTENDED, INTRO, PANEL, PANEL_H2, PANEL_P, TAG } from '@/components/dashboard/panel-styles';

/**
 * Szablony odpowiedzi firmy (0940) — noindex, `force-dynamic` (sesja/RLS), guard z layoutu
 * panelu. Tylko recruiter+ aktywnej firmy; rola member widzi wyjaśnienie zamiast formularza.
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({ params }: { params: Promise<{ locale: string }> }): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'messageTemplates' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

export default async function EmployerTemplatesPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'messageTemplates' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const result = await getMessageTemplatesPage();

  return (
    <div className="space-y-7">
      <header>
        <p className={EYEBROW}>{td('employerRole')}</p>
        <h1 className={H1_EXTENDED}>{t('title')}</h1>
        <p className={INTRO}>{t('intro')}</p>
      </header>
      {result.status === 'ok' ? (
        <MessageTemplatesManager companyId={result.companyId} templates={result.templates} />
      ) : result.status === 'denied' ? (
        <RecruiterOnlyNote locale={locale} />
      ) : result.status === 'demo' ? (
        <p className={TAG}>{t('demo')}</p>
      ) : result.status === 'no_company' ? (
        <section className={PANEL}>
          <p className={PANEL_P}>{t('noCompany')}</p>
        </section>
      ) : (
        <section role="alert" className={PANEL}>
          <h2 className={PANEL_H2}>{t('loadError')}</h2>
          <a href={`/${locale}/employer/szablony`} className={`mt-5 ${BTN_SECONDARY}`}>{t('retry')}</a>
        </section>
      )}
    </div>
  );
}
