import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CompanyForm } from '@/components/employer/CompanyForm';
import { DEMO_NOTE, EYEBROW, H1_EXTENDED, INTRO, PAPER } from '@/components/dashboard/panel-styles';

/**
 * Panel pracodawcy — kolejna firma (#403). Zalogowany pracodawca zakłada następną firmę
 * (RPC `create_additional_company`: owner, status `unverified`, limit 5, audyt); po sukcesie
 * panel przełącza się na nową firmę. NOINDEX (panel), `force-dynamic` (sesja).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'team' });
  return { title: t('addCompanyTitle'), robots: { index: false, follow: false } };
}

export default async function EmployerAddCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'team' });
  const tc = await getTranslations({ locale, namespace: 'company' });

  return (
    <div className="min-w-0 max-w-4xl space-y-[22px]">
      <header className="min-w-0">
        <p className={EYEBROW}>{tc('title')}</p>
        <h1 className={H1_EXTENDED}>{t('addCompanyTitle')}</h1>
        <p className={INTRO}>{t('addCompanyDesc')}</p>
      </header>
      <section className={PAPER}>
        <p className={DEMO_NOTE}>{tc('verificationNote')}</p>
        <CompanyForm mode="add" />
      </section>
    </div>
  );
}
