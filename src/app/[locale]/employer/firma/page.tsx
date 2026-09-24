import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getCompanyModerationDecisions, getMyCompany } from '@/lib/data/company';
import { CompanyModerationDecisions } from '@/components/employer/CompanyModerationDecisions';
import { CompanyForm } from '@/components/employer/CompanyForm';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import { CompanyLoadError } from '@/components/employer/CompanyLoadError';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import { CompanyReverifyButton } from '@/components/employer/CompanyReverifyButton';

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
    <div className="max-w-4xl space-y-6">
      <header className="overflow-hidden rounded-3xl bg-foreground px-5 py-7 text-background sm:px-8 sm:py-9">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-background/70">
          {t('title')}
        </p>
        <div className="mt-4 flex min-w-0 flex-wrap items-center gap-4">
          {company ? (
            <span
              className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-primary text-xl font-bold text-primary-foreground"
              aria-hidden="true"
            >
              {company.name.trim().charAt(0).toLocaleUpperCase(locale) || '•'}
            </span>
          ) : null}
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-2xl font-bold tracking-tight sm:text-3xl">
              {company?.name || t('title')}
            </h1>
            <p className="mt-1 text-sm text-background/80">
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
          <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
            <h2 className="text-base font-semibold text-foreground">
              {t('detailsTitle')}
            </h2>
            <dl className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-border sm:grid-cols-2">
              <div className="min-w-0 bg-card p-4 sm:p-5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('slug')}
                </dt>
                <dd className="mt-2 break-all text-base font-medium text-foreground">
                  {company.slug || '—'}
                </dd>
              </div>
              <div className="min-w-0 bg-card p-4 sm:p-5">
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('statusLabel')}
                </dt>
                <dd className="mt-2 break-words text-base font-medium text-foreground">
                  {statusLabel}
                </dd>
              </div>
              {verifiedLabel ? (
                <div className="min-w-0 bg-card p-4 sm:p-5">
                  <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {t('verifiedAt')}
                  </dt>
                  <dd className="mt-2 break-words text-base font-medium text-foreground">
                    {verifiedLabel}
                  </dd>
                </div>
              ) : null}
            </dl>
          </section>

          {/* Edycja danych podstawowych (nazwa, VAT) — status pozostaje po stronie admina. */}
          {company.canEdit ? (
            <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
              <h2 className="text-base font-semibold text-foreground">
                {t('editTitle')}
              </h2>
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
            <p className="rounded-3xl border border-border bg-card p-5 text-base text-muted-foreground sm:p-7">
              {t('editOwnerOnly')}
            </p>
          )}

          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            {t('verificationNote')}
          </p>
        </>
      ) : null}
    </div>
  );
}
