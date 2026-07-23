import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getMyCompany } from '@/lib/data/company';
import { CompanyForm } from '@/components/employer/CompanyForm';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';

/**
 * Panel pracodawcy — Firma (Etap 4).
 *
 * Brak firmy → formularz zakładania (CompanyForm mode="create"). Firma istnieje → baner statusu
 * weryfikacji (CompanyStatusBanner) + dane read-only (identyfikator/status/data weryfikacji)
 * + edycja nazwy i VAT (CompanyForm mode="edit"). Publikacja ofert i wysyłka propozycji wymaga
 * statusu `verified` (nadaje administrator) — objaśnione w nocie.
 *
 * NOINDEX (panel) + `force-dynamic` (dane zależne od sesji/RLS). Guard członkostwa dziedziczony
 * z `employer/layout.tsx`; bez env → firma DEMO (widok danych).
 */

export const dynamic = 'force-dynamic';

/** Etykieta statusu firmy z i18n (fallback: surowy status). */
const STATUS_KEY: Record<string, string> = {
  unverified: 'statusUnverified',
  pending: 'statusPending',
  verified: 'statusVerified',
  rejected: 'statusRejected',
  suspended: 'statusSuspended',
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'company' });
  return {
    title: t('title'),
    robots: { index: false, follow: false },
  };
}

export default async function EmployerCompanyPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'company' });
  const company = await getMyCompany();

  const statusLabel =
    company && STATUS_KEY[company.status] ? t(STATUS_KEY[company.status]!) : company?.status ?? '';
  const verifiedLabel =
    company?.verifiedAt != null
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(new Date(company.verifiedAt))
      : null;

  return (
    <div className="max-w-2xl space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {company ? t('detailsSubtitle') : t('createSubtitle')}
        </p>
      </header>

      {company ? (
        <>
          <CompanyStatusBanner status={company.status} />

          {/* Dane read-only (nieedytowalne przez pracodawcę: identyfikator, status, weryfikacja). */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">{t('detailsTitle')}</h2>
            <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('slug')}
                </dt>
                <dd className="mt-0.5 break-all text-sm text-foreground">{company.slug || '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('statusLabel')}
                </dt>
                <dd className="mt-0.5 text-sm text-foreground">{statusLabel}</dd>
              </div>
              {verifiedLabel ? (
                <div>
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('verifiedAt')}
                  </dt>
                  <dd className="mt-0.5 text-sm text-foreground">{verifiedLabel}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Edycja danych podstawowych (nazwa, VAT) — status pozostaje po stronie admina. */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="text-base font-semibold text-foreground">{t('editTitle')}</h2>
            <div className="mt-4">
              <CompanyForm
                mode="edit"
                defaultValues={{ name: company.name, vatNumber: company.vatNumber ?? '' }}
              />
            </div>
          </section>

          <p className="text-sm text-muted-foreground">{t('verificationNote')}</p>
        </>
      ) : (
        <section className="rounded-lg border border-border bg-card p-5">
          <h2 className="text-base font-semibold text-foreground">{t('createTitle')}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t('verificationNote')}</p>
          <div className="mt-4">
            <CompanyForm mode="create" />
          </div>
        </section>
      )}
    </div>
  );
}
