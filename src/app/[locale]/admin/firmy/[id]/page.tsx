import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { parseUuid } from '@/lib/admin/list-params';
import { getCompanyDetail, type AdminCompanyDetail } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import {
  EMPTY,
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
  TAG,
  TEXT_LINK,
} from '@/components/admin/admin-styles';
import { cn } from '@/lib/utils';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';
import { CompanyViesCheck } from '@/components/admin/CompanyViesCheck';
import { CompanyLinksReviewActions } from '@/components/admin/CompanyLinksReviewActions';

/**
 * Panel administratora — szczegół firmy (#310).
 *
 * Decyzja o weryfikacji nie zapada „na ślepo”: dane rejestrowe (VAT, KBO, kontakt, adres),
 * uzasadnienie ostatniego odrzucenia/zawieszenia, członkowie firmy (rola, aktywny dostęp)
 * i najnowsze oferty. Sekcja VIES (#92): ostatni wynik weryfikacji numeru VAT z datą i ręczne
 * ponowienie — informacja pomocnicza, status firmy zmienia wyłącznie admin. Strona WWW i logo
 * (0204): propozycja firmy czeka tu na decyzję („Zatwierdź” publikuje adresy w ofertach
 * i profilu firmy, „Odrzuć” wymaga uzasadnienia) — `CompanyLinksReviewActions`. Akcje statusu te same co na liście (`CompanyStatusActions` → dialog
 * z wymaganym uzasadnieniem dla odrzucenia/zawieszenia → RPC 0084: powiadomienie i e-mail
 * do właściciela w JEGO języku, wpis w dzienniku). Po decyzji fokus na nagłówku strony (#415).
 *
 * Odczyt service-rolem po potwierdzeniu roli admina (`getCompanyDetail` → `requireAdmin`).
 * Nieistniejąca firma → jawny stan „nie znaleziono”, błąd odczytu → stan błędu (#311).
 * NOINDEX + `force-dynamic`.
 */

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; id: string }> };

const MEMBER_ROLE_KEY: Record<string, string> = {
  owner: 'memberRoleOwner',
  admin: 'memberRoleAdmin',
  recruiter: 'memberRoleRecruiter',
  member: 'memberRoleMember',
};

const JOB_STATUS_KEY: Record<string, string> = {
  draft: 'jobStatusDraft',
  active: 'jobStatusActive',
  paused: 'jobStatusPaused',
  closed: 'jobStatusClosed',
  expired: 'jobStatusExpired',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('companiesTitle'),
    robots: { index: false, follow: false },
  };
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href="/admin/firmy" className={TEXT_LINK}>
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

/** Pole danych: etykieta jak `.stat span` (12 px muted), wartość jak `.job h3` (15 px / 600). */
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-1.5 whitespace-pre-line break-words text-[15px] font-semibold tracking-[-0.03em] text-foreground">
        {value}
      </dd>
    </div>
  );
}

function addressOf(company: AdminCompanyDetail): string | null {
  const cityLine = [company.postalCode, company.city].filter(Boolean).join(' ');
  const parts = [company.address, cityLine].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join('\n') : null;
}

export default async function AdminCompanyDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const formatDate = createAppDateFormatter(locale);

  const result = await getCompanyDetail(id);

  if (result.status === 'error') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <BackLink label={t('backToCompanies')} />
        <AdminPageHeader
          extended
          eyebrow={t('targetCompany')}
          title={t('companiesTitle')}
          subtitle={t('companyDetailSubtitle')}
        />
        <AdminLoadError retryHref={`/${locale}/admin/firmy/${encodeURIComponent(id)}`} />
      </div>
    );
  }

  if (result.status === 'not_found') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <BackLink label={t('backToCompanies')} />
        <AdminPageHeader
          extended
          eyebrow={t('targetCompany')}
          title={t('companyNotFoundTitle')}
          subtitle={t('companyNotFoundHint')}
        />
      </div>
    );
  }

  const company = result.company;
  const dash = '—';
  const address = addressOf(company);
  const historyId = parseUuid(company.id);

  return (
    <div className="min-w-0 space-y-[22px]">
      <BackLink label={t('backToCompanies')} />
      <AdminPageHeader
        extended
        eyebrow={t('targetCompany')}
        title={company.name || t('nameFallback')}
        subtitle={t('companyDetailSubtitle')}
      />

      {/* Uzasadnienie ostatniego odrzucenia/zawieszenia (`.notice`) */}
      {company.statusReason ? (
        <div className={cn(NOTICE, 'my-0')}>
          <div className="min-w-0">
            <p className={NOTICE_TITLE}>{t('statusReasonLabel')}</p>
            <p className={cn(NOTICE_TEXT, 'whitespace-pre-line text-foreground')}>
              {company.statusReason}
            </p>
          </div>
        </div>
      ) : null}

      {/* Status i decyzja */}
      <section aria-labelledby="company-status-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="company-status-heading" className={PANEL_H2}>
            {t('sectionStatus')}
          </h2>
          <AdminStatusBadge kind="company" status={company.status} />
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('colCreated')} value={formatDate(company.createdAt)} />
          <Field
            label={t('detailVerifiedAt')}
            value={company.verifiedAt ? formatDate(company.verifiedAt) : dash}
          />
        </dl>
        <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
          <CompanyStatusActions company={company} createdLabel={formatDate(company.createdAt)} />
          {historyId ? (
            <Link
              href={{ pathname: '/admin/dziennik', query: { entity: 'company', id: historyId } }}
              className={cn(TEXT_LINK, 'px-1 text-xs')}
            >
              {t('auditHistoryLink')}
            </Link>
          ) : null}
        </div>
      </section>

      {/* Dane firmy */}
      <section aria-labelledby="company-data-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="company-data-heading" className={PANEL_H2}>
            {t('sectionCompanyData')}
          </h2>
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('detailVat')} value={company.vatNumber ?? dash} />
          <Field label={t('detailRegistration')} value={company.registrationNumber ?? dash} />
          <Field label={t('detailEmail')} value={company.email ?? dash} />
          <Field label={t('detailPhone')} value={company.phone ?? dash} />
          <Field label={t('detailWebsite')} value={company.website ?? dash} />
          <Field label={t('detailAddress')} value={address ?? dash} />
          <Field label={t('detailRegion')} value={company.region ?? dash} />
          <Field label={t('detailCountry')} value={company.country ?? dash} />
          <Field label={t('detailIndustry')} value={company.industry ?? dash} />
        </dl>
        {company.description ? (
          <dl className="mt-6 border-t border-border pt-5">
            <Field label={t('detailDescription')} value={company.description} />
          </dl>
        ) : null}
      </section>

      {/* Strona WWW i logo — propozycja firmy do decyzji (0204) */}
      <section aria-labelledby="company-links-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="company-links-heading" className={PANEL_H2}>
            {t('sectionCompanyLinks')}
          </h2>
          {company.linksReview ? (
            <span
              className={cn(
                TAG,
                company.linksReview.status === 'pending' ? 'bg-warning/10 text-warning-text' : 'bg-error/10 text-error-text',
              )}
            >
              {t(company.linksReview.status === 'pending' ? 'companyLinksStatusPending' : 'companyLinksStatusRejected')}
            </span>
          ) : null}
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('companyLinksPublishedWebsite')} value={company.website ?? dash} />
          <Field label={t('companyLinksPublishedLogo')} value={company.logoUrl ?? dash} />
          {company.linksReview ? (
            <>
              <Field
                label={t('companyLinksProposedWebsite')}
                value={company.linksReview.website ?? t('companyLinksRemoved')}
              />
              <Field
                label={t('companyLinksProposedLogo')}
                value={company.linksReview.logoUrl ?? t('companyLinksRemoved')}
              />
              <Field
                label={t('companyLinksSubmittedAt')}
                value={formatDate(company.linksReview.submittedAt)}
              />
              {company.linksReview.reason ? (
                <Field label={t('statusReasonLabel')} value={company.linksReview.reason} />
              ) : null}
            </>
          ) : null}
        </dl>
        {company.linksReview?.status === 'pending' && company.linksReview.submittedAt ? (
          <div className="mt-6 border-t border-border pt-5">
            <p className={cn(PANEL_P, 'mb-3')}>{t('companyLinksReviewHint')}</p>
            <CompanyLinksReviewActions
              companyId={company.id}
              submittedAt={company.linksReview.submittedAt}
              websiteLabel={company.linksReview.website ?? t('companyLinksRemoved')}
              logoUrlLabel={company.linksReview.logoUrl ?? t('companyLinksRemoved')}
            />
          </div>
        ) : !company.linksReview ? (
          <p className={cn(PANEL_P, 'mt-4')}>{t('companyLinksNoProposal')}</p>
        ) : null}
      </section>

      {/* Weryfikacja VAT w VIES (#92) */}
      <CompanyViesCheck companyId={company.id} initial={company.vies} />

      <div className="grid min-w-0 grid-cols-[1.4fr_1fr] gap-[19px] max-[1050px]:grid-cols-1">
        {/* Członkowie (`.panel` z wierszami `.job`) */}
        <section aria-labelledby="company-members-heading" className={PANEL}>
          <div className={SECTION_HEAD}>
            <h2 id="company-members-heading" className={PANEL_H2}>
              {t('sectionMembers')}
            </h2>
          </div>
          {company.members.length === 0 ? (
            <p className={EMPTY}>{t('membersEmpty')}</p>
          ) : (
            <ul>
              {company.members.map((member) => (
                <li key={member.id} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <p className={ROW_TITLE}>{member.name || t('nameFallback')}</p>
                    <p className={ROW_META}>{member.email ?? dash}</p>
                    <p className={ROW_META}>
                      {t('colMemberSince')}: {formatDate(member.since)}
                    </p>
                    <span className={cn(TAG, 'mr-[5px] mt-1.5')}>
                      {t(MEMBER_ROLE_KEY[member.role] ?? 'memberRoleMember')}
                    </span>
                    <span
                      className={cn(
                        TAG,
                        'mt-1.5',
                        member.isActive ? 'bg-success/10 text-success-text' : undefined,
                      )}
                    >
                      {t(member.isActive ? 'memberActive' : 'memberInactive')}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Oferty */}
        <section aria-labelledby="company-jobs-heading" className={PANEL}>
          <div className={SECTION_HEAD}>
            <h2 id="company-jobs-heading" className={PANEL_H2}>
              {t('sectionJobs')}
            </h2>
            {company.jobsTotal > company.jobs.length ? (
              <p className={PANEL_P}>
                {t('jobsShown', { shown: company.jobs.length, total: company.jobsTotal })}
              </p>
            ) : null}
          </div>
          {company.jobs.length === 0 ? (
            <p className={EMPTY}>{t('jobsEmpty')}</p>
          ) : (
            <ul>
              {company.jobs.map((job) => (
                <li key={job.id} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <p className={ROW_TITLE}>
                      {job.status === 'active' && job.slug ? (
                        <Link
                          href={`/oferty-pracy/${job.slug}`}
                          className={cn(INLINE_LINK, 'underline')}
                        >
                          {job.title || t('targetUnnamed')}
                        </Link>
                      ) : (
                        job.title || t('targetUnnamed')
                      )}
                    </p>
                    <p className={ROW_META}>{formatDate(job.createdAt)}</p>
                    <span className={cn(TAG, 'mt-1.5')}>
                      {t(JOB_STATUS_KEY[job.status] ?? 'statusUnknown')}
                    </span>
                    {job.status === 'active' ? (
                      <a
                        href={`/api/employer/jobs/${job.id}/banner?format=1200x300&locale=${locale}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={cn(TEXT_LINK, 'ml-2 mt-1.5 px-0 text-xs')}
                      >
                        {t('jobBannerLink')}
                      </a>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
