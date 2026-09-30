import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getCurrentIdentity } from '@/lib/auth/current';
import { readSignupCompanyName } from '@/lib/auth/signup-company-name';
import { isPortalAuthConfigured } from '@/lib/env';
import { getCompanyById, getCompanyModerationDecisions, getMyCompany } from '@/lib/data/company';
import { CompanyModerationDecisions } from '@/components/employer/CompanyModerationDecisions';
import { CompanyForm } from '@/components/employer/CompanyForm';
import { CompanyDescriptionForm } from '@/components/employer/CompanyDescriptionForm';
import { CompanyLinksForm } from '@/components/employer/CompanyLinksForm';
import { CompanyAgencyForm } from '@/components/employer/CompanyAgencyForm';
import { CompanyDescriptionLocaleForm } from '@/components/employer/CompanyDescriptionLocaleForm';
import { env } from '@/lib/env';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { CompanyStatusBanner } from '@/components/employer/CompanyStatusBanner';
import { CompanyLoadError } from '@/components/employer/CompanyLoadError';
import { CompanyOnboarding } from '@/components/employer/CompanyOnboarding';
import { CompanyReverifyButton } from '@/components/employer/CompanyReverifyButton';
import { SwitchToCompanyButton } from '@/components/employer/SwitchToCompanyButton';
import {
  EYEBROW,
  H1_EXTENDED,
  H2_EXTENDED,
  ICON_BOX,
  INFO_LABEL,
  INFO_PAIRS,
  INFO_VALUE,
  INTRO,
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
  PANEL,
  PAPER,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/** UUID v4 (parametr `?firma=` w linku decyzji — nigdy nie ufamy mu bez sprawdzenia dostępu). */
const COMPANY_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ firma?: string | string[] }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'company' });
  const companyLoad = await getMyCompany();
  const company = companyLoad.status === 'ok' ? companyLoad.company : null;

  // #843: link decyzji (e-mail „Firma odrzucona/zawieszona/zweryfikowana", powiadomienie
  // in-app) niesie identyfikator firmy, KTÓREJ DOTYCZY zdarzenie — właściciel kilku firm
  // może mieć w cookie inną AKTYWNĄ firmę. Gdy identyfikatory się różnią, pokazujemy dane
  // docelowej firmy osobno (read-only + jawne przełączenie kontekstu), zamiast ciszej
  // podmiany na aktywną firmę z cookie.
  const rawFirmaParam = (await searchParams)?.firma;
  const requestedCompanyId =
    typeof rawFirmaParam === 'string' && COMPANY_ID_RE.test(rawFirmaParam) ? rawFirmaParam : null;

  if (
    requestedCompanyId &&
    companyLoad.status === 'ok' &&
    company &&
    company.id !== requestedCompanyId
  ) {
    const targetLoad = await getCompanyById(requestedCompanyId);
    const target = targetLoad.status === 'ok' ? targetLoad.company : null;
    const targetStatusLabel = target && STATUS_KEY[target.status] ? t(STATUS_KEY[target.status]!) : '';
    const targetVerifiedLabel =
      target?.verifiedAt != null
        ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: APP_TIME_ZONE }).format(
            new Date(target.verifiedAt),
          )
        : null;

    return (
      <div className="min-w-0 max-w-4xl space-y-[22px]">
        <header className="min-w-0">
          <p className={EYEBROW}>{t('title')}</p>
          <h1 className={H1_EXTENDED}>{target ? target.name : t('targetTitle')}</h1>
          <p className={INTRO}>{t('targetIntro')}</p>
        </header>

        {targetLoad.status === 'error' ? (
          <CompanyLoadError />
        ) : target ? (
          <>
            <CompanyStatusBanner status={target.status} reason={target.statusReason} />
            <section className={PAPER}>
              <h2 className={H2_EXTENDED}>{t('detailsTitle')}</h2>
              <dl className={INFO_PAIRS}>
                <div className="min-w-0">
                  <dt className={INFO_LABEL}>{t('slug')}</dt>
                  <dd className={cn(INFO_VALUE, 'break-all')}>{target.slug || '—'}</dd>
                </div>
                <div className="min-w-0">
                  <dt className={INFO_LABEL}>{t('statusLabel')}</dt>
                  <dd className={INFO_VALUE}>{targetStatusLabel}</dd>
                </div>
                {targetVerifiedLabel ? (
                  <div className="min-w-0">
                    <dt className={INFO_LABEL}>{t('verifiedAt')}</dt>
                    <dd className={INFO_VALUE}>{targetVerifiedLabel}</dd>
                  </div>
                ) : null}
              </dl>
            </section>
            <SwitchToCompanyButton companyId={target.id} />
          </>
        ) : (
          <section className={cn(NOTICE, 'border-border bg-card')}>
            <div className="min-w-0">
              <h2 className={NOTICE_TITLE}>{t('targetUnavailableTitle')}</h2>
              <p className={NOTICE_TEXT}>{t('targetUnavailableHint')}</p>
            </div>
          </section>
        )}
      </div>
    );
  }

  if (companyLoad.status === 'ok' && !company) {
    // #365: nazwa firmy z rejestracji (metadane konta) wypełnia formularz domyślnie.
    // `!company` tylko gdy konta są skonfigurowane (bez env `getMyCompany` zwraca demo) —
    // sesja jest więc już zagwarantowana przez guard w `employer/layout.tsx`.
    const identity = isPortalAuthConfigured() ? await getCurrentIdentity() : null;
    const defaultName = identity ? await readSignupCompanyName(identity) : '';
    return <CompanyOnboarding defaultName={defaultName} />;
  }
  // Decyzje moderacyjne (#42) — uzasadnienie widzi owner/admin firmy (RPC zwraca pustą listę innym).
  const moderation =
    company && company.canEdit ? await getCompanyModerationDecisions(company.id) : null;

  const statusLabel =
    company && STATUS_KEY[company.status]
      ? t(STATUS_KEY[company.status]!)
      : (company?.status ?? '');
  const verifiedLabel =
    company?.verifiedAt != null
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'long', timeZone: APP_TIME_ZONE }).format(
          new Date(company.verifiedAt),
        )
      : null;
  // Host własnej witryny — jedyny dozwolony podgląd logo przez next/image (CompanyLinksForm).
  const ownHost = (() => {
    try {
      return new URL(env.siteUrl).host;
    } catch {
      return '';
    }
  })();

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
              company.status === 'rejected' && company.canEdit ? <CompanyReverifyButton key={company.id} companyId={company.id} /> : null
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
            <>
              <section className={PAPER}>
                <h2 className={H2_EXTENDED}>{t('editTitle')}</h2>
                <div className="mt-4">
                  <CompanyForm
                    mode="edit"
                    companyId={company.id}
                    verified={company.status === 'verified'}
                    defaultValues={{
                      name: company.name,
                      vatNumber: company.vatNumber ?? '',
                    }}
                  />
                </div>
              </section>

              {/* Strona WWW i logo (#112) — nie cofa weryfikacji; nowy adres zatwierdza admin portalu (0156). */}
              <section className={PAPER}>
                <h2 className={H2_EXTENDED}>{t('linksTitle')}</h2>
                <p className={INTRO}>{t('linksSubtitle')}</p>
                <div className="mt-4">
                  <CompanyLinksForm
                    companyId={company.id}
                    defaultValues={
                      company.linksReview
                        ? {
                            website: company.linksReview.website ?? '',
                            logoUrl: company.linksReview.logoUrl ?? '',
                          }
                        : { website: company.website ?? '', logoUrl: company.logoUrl ?? '' }
                    }
                    published={{ website: company.website, logoUrl: company.logoUrl }}
                    review={company.linksReview}
                    ownHost={ownHost}
                  />
                </div>
              </section>

              {/* Opis firmy (#868) — nie cofa weryfikacji; nowy tekst zatwierdza admin portalu (0198). */}
              <section className={PAPER}>
                <h2 className={H2_EXTENDED}>{t('descriptionTitle')}</h2>
                <p className={INTRO}>{t('descriptionSubtitle')}</p>
                <div className="mt-4">
                  <CompanyDescriptionForm
                    companyId={company.id}
                    companyName={company.name}
                    defaultValue={
                      company.descriptionReview ? company.descriptionReview.text : (company.description ?? '')
                    }
                    published={company.description}
                    review={company.descriptionReview}
                  />
                </div>
              </section>

              {/* #708 (0975): język opisu — publiczny profil oznacza nim opis i informuje o innym języku. */}
              {company.descriptionLanguage.hasDescription ? (
                <section className={PAPER}>
                  <h2 className={H2_EXTENDED}>{t('descriptionLocaleTitle')}</h2>
                  <p className={INTRO}>{t('descriptionLocaleSubtitle')}</p>
                  <div className="mt-4">
                    <CompanyDescriptionLocaleForm
                      key={company.id}
                      companyId={company.id}
                      locale={company.descriptionLanguage.locale}
                    />
                  </div>
                </section>
              ) : null}

              {/* 0167: agencja pracy tymczasowej — deklaracja + numer uznania (sprawdza admin). */}
              <section className={PAPER}>
                <h2 className={H2_EXTENDED}>{t('agencyTitle')}</h2>
                <p className={INTRO}>{t('agencySubtitle')}</p>
                <div className="mt-4">
                  <CompanyAgencyForm
                    companyId={company.id}
                    isAgency={company.agency.isAgency}
                    recognitionNumber={company.agency.recognitionNumber}
                    checkStatus={company.agency.checkStatus}
                  />
                </div>
              </section>
            </>
          ) : (
            <p className={cn(PANEL, 'text-sm text-muted-foreground')}>{t('editOwnerOnly')}</p>
          )}

          <p className={INTRO}>{t('verificationNote')}</p>
        </>
      ) : null}
    </div>
  );
}
