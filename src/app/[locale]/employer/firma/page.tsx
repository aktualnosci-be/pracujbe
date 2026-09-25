import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getCompanyModerationDecisions, getMyCompany } from '@/lib/data/company';
import { CompanyModerationDecisions } from '@/components/employer/CompanyModerationDecisions';
import { CompanyForm } from '@/components/employer/CompanyForm';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import { CompanyLoadError } from '@/components/employer/CompanyLoadError';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import { CompanyReverifyButton } from '@/components/employer/CompanyReverifyButton';
import {
  EYEBROW,
  H1_EXTENDED,
  H2_EXTENDED,
  ICON_BOX,
  INFO_LABEL,
  INFO_PAIRS,
  INFO_VALUE,
  INTRO,
  PANEL,
  PAPER,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Panel pracodawcy — Firma (Etap 4).
 *
 * Brak firmy → formularz zakładania (CompanyOnboarding; layout pokazuje go też na innych
 * podstronach). Firma istnieje → baner statusu weryfikacji (CompanyStatusBanner; odrzucona
 * firma ma akcję ponownego zgłoszenia — #400) + dane read-only (identyfikator/status/data
 * weryfikacji) + edycja nazwy i VAT (CompanyForm mode="edit"; zmiana tych danych zweryfikowanej
 * firmy wraca do weryfikacji). Publikacja ofert i wysyłka propozycji wymaga statusu `verified`
 * (nadaje administrator) — objaśnione w nocie. Decyzje moderacyjne wobec firmy i jej ofert
 * (#42) — uzasadnienie dla ownera/admina firmy (CompanyModerationDecisions).
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
  const companyLoad = await getMyCompany();
  const company = companyLoad.status === 'ok' ? companyLoad.company : null;
  if (companyLoad.status === 'ok' && !company) return <CompanyOnboarding />;
  // Decyzje moderacyjne (#42) — uzasadnienie widzi owner/admin firmy (RPC zwraca pustą listę innym).
  const moderation =
    company && company.canEdit ? await getCompanyModerationDecisions(company.id) : null;

  const statusLabel =
    company && STATUS_KEY[company.status]
      ? t(STATUS_KEY[company.status]!)
      : (company?.status ?? '');
  const verifiedLabel =
    company?.verifiedAt != null
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long' }).format(
          new Date(company.verifiedAt),
        )
      : null;

  return (
    <div className="min-w-0 max-w-4xl space-y-[22px]">
      <header className="min-w-0">
        <p className={EYEBROW}>{t('title')}</p>
        <div className="flex min-w-0 flex-wrap items-center gap-4">
          {company ? (
            <span className={ICON_BOX} aria-hidden="true">
              {company.name.trim().charAt(0).toLocaleUpperCase(locale) || '•'}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className={H1_EXTENDED}>{company?.name || t('title')}</h1>
            <p className={INTRO}>
              {companyLoad.status === 'error'
                ? t('loadErrorHint')
                : company
                  ? t('detailsSubtitle')
                  : t('createSubtitle')}
            </p>
          </div>
        </div>
      </header>

      {companyLoad.status === 'error' ? (
        <CompanyLoadError />
      ) : company ? (
        <>
          <CompanyStatusBanner
            status={company.status}
            reason={company.statusReason}
            action={
              company.status === 'rejected' && company.canEdit ? <CompanyReverifyButton /> : null
            }
          />

          {moderation ? (
            <CompanyModerationDecisions
              locale={locale}
              decisions={moderation.status === 'ok' ? moderation.decisions : []}
              loadError={moderation.status === 'error'}
            />
          ) : null}

          {/* Dane read-only (nieedytowalne przez pracodawcę: identyfikator, status, weryfikacja). */}
          <section className={PAPER}>
            <h2 className={H2_EXTENDED}>{t('detailsTitle')}</h2>
            <dl className={INFO_PAIRS}>
              <div className="min-w-0">
                <dt className={INFO_LABEL}>{t('slug')}</dt>
                <dd className={cn(INFO_VALUE, 'break-all')}>{company.slug || '—'}</dd>
              </div>
              <div className="min-w-0">
                <dt className={INFO_LABEL}>{t('statusLabel')}</dt>
                <dd className={INFO_VALUE}>{statusLabel}</dd>
              </div>
              {verifiedLabel ? (
                <div className="min-w-0">
                  <dt className={INFO_LABEL}>{t('verifiedAt')}</dt>
                  <dd className={INFO_VALUE}>{verifiedLabel}</dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Edycja danych podstawowych (nazwa, VAT) — status pozostaje po stronie admina. */}
          {company.canEdit ? (
            <section className={PAPER}>
              <h2 className={H2_EXTENDED}>{t('editTitle')}</h2>
              <div className="mt-4">
                <CompanyForm
                  mode="edit"
                  verified={company.status === 'verified'}
                  defaultValues={{
                    name: company.name,
                    vatNumber: company.vatNumber ?? '',
                  }}
                />
              </div>
            </section>
          ) : (
            <p className={cn(PANEL, 'text-sm text-muted-foreground')}>{t('editOwnerOnly')}</p>
          )}

          <p className={INTRO}>{t('verificationNote')}</p>
        </>
      ) : null}
    </div>
  );
}
