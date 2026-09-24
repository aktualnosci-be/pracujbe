import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { CompanyForm } from '@/components/employer/CompanyForm';

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
    <div className="max-w-4xl space-y-6">
      <header className="min-w-0">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('addCompanyTitle')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{t('addCompanyDesc')}</p>
      </header>
      <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
        <p className="text-sm text-muted-foreground">{tc('verificationNote')}</p>
        <div className="mt-4">
          <CompanyForm mode="add" />
        </div>
      </section>
    </div>
  );
}
