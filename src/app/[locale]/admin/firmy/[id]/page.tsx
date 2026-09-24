import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { parseUuid } from '@/lib/admin/list-params';
import { getCompanyDetail, type AdminCompanyDetail } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { ADMIN_CARD, AdminPageHeader } from '@/components/admin/AdminListControls';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';
import { CompanyViesCheck } from '@/components/admin/CompanyViesCheck';

/**
 * Panel administratora — szczegół firmy (#310).
 *
 * Decyzja o weryfikacji nie zapada „na ślepo”: dane rejestrowe (VAT, KBO, kontakt, adres),
 * uzasadnienie ostatniego odrzucenia/zawieszenia, członkowie firmy (rola, aktywny dostęp)
 * i najnowsze oferty. Sekcja VIES (#92): ostatni wynik weryfikacji numeru VAT z datą i ręczne
 * ponowienie — informacja pomocnicza, status firmy zmienia wyłącznie admin. Akcje statusu te same co na liście (`CompanyStatusActions` → dialog
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
    <Link
      href="/admin/firmy"
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-primary-dark underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-base font-semibold text-foreground">
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
      <div className="space-y-6">
        <BackLink label={t('backToCompanies')} />
        <AdminPageHeader
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
      <div className="space-y-6">
        <BackLink label={t('backToCompanies')} />
        <section className={`${ADMIN_CARD} p-5 sm:p-8`}>
          <AdminPageHeader
            eyebrow={t('targetCompany')}
            title={t('companyNotFoundTitle')}
            subtitle={t('companyNotFoundHint')}
          />
        </section>
      </div>
    );
  }

  const company = result.company;
  const dash = '—';
  const address = addressOf(company);
  const historyId = parseUuid(company.id);

  return (
    <div className="space-y-6">
      <BackLink label={t('backToCompanies')} />
      <AdminPageHeader
        eyebrow={t('targetCompany')}
        title={company.name || t('nameFallback')}
        subtitle={t('companyDetailSubtitle')}
      />

      {/* Status i decyzja */}
      <section
        aria-labelledby="company-status-heading"
        className={`${ADMIN_CARD} space-y-5 p-5 sm:p-7`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="company-status-heading" className="min-w-0 break-words text-xl font-bold text-foreground">
            {t('sectionStatus')}
          </h2>
          <AdminStatusBadge kind="company" status={company.status} />
        </div>
        {company.statusReason ? (
          <div className="rounded-2xl bg-soft p-4 text-sm">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {t('statusReasonLabel')}
            </p>
            <p className="mt-1 whitespace-pre-line break-words text-foreground">
              {company.statusReason}
            </p>
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('colCreated')} value={formatDate(company.createdAt)} />
          <Field
            label={t('detailVerifiedAt')}
            value={company.verifiedAt ? formatDate(company.verifiedAt) : dash}
          />
        </dl>
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-5">
          <CompanyStatusActions company={company} createdLabel={formatDate(company.createdAt)} />
          {historyId ? (
            <Link
              href={{ pathname: '/admin/dziennik', query: { entity: 'company', id: historyId } }}
              className="inline-flex min-h-11 items-center px-1 text-sm font-semibold text-primary-dark underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {t('auditHistoryLink')}
            </Link>
          ) : null}
        </div>
      </section>

      {/* Dane firmy */}
      <section
        aria-labelledby="company-data-heading"
        className={`${ADMIN_CARD} p-5 sm:p-7`}
      >
        <h2 id="company-data-heading" className="min-w-0 break-words text-xl font-bold text-foreground">
          {t('sectionCompanyData')}
        </h2>
        <dl className="mt-5 grid grid-cols-1 gap-5 sm:grid-cols-2">
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

      {/* Weryfikacja VAT w VIES (#92) */}
      <CompanyViesCheck companyId={company.id} initial={company.vies} />

      {/* Członkowie */}
      <section
        aria-labelledby="company-members-heading"
        className={ADMIN_CARD}
      >
        <h2
          id="company-members-heading"
          className="break-words p-5 text-xl font-bold text-foreground sm:px-7"
        >
          {t('sectionMembers')}
        </h2>
        {company.members.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-muted-foreground sm:px-7">{t('membersEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {company.members.map((member) => (
              <li
                key={member.id}
                className="grid min-w-0 gap-2 p-5 text-sm sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-4 sm:px-7"
              >
                <div className="min-w-0">
                  <p className="break-words font-semibold text-foreground">
                    {member.name || t('nameFallback')}
                  </p>
                  <p className="break-words text-muted-foreground">{member.email ?? dash}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  <span className="inline-flex items-center rounded-full bg-soft px-2.5 py-0.5 text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
                    {t(MEMBER_ROLE_KEY[member.role] ?? 'memberRoleMember')}
                  </span>
                  <span
                    className={
                      member.isActive
                        ? 'font-medium text-success-text'
                        : 'font-medium text-muted-foreground'
                    }
                  >
                    {t(member.isActive ? 'memberActive' : 'memberInactive')}
                  </span>
                  <span>
                    {t('colMemberSince')}: {formatDate(member.since)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Oferty */}
      <section
        aria-labelledby="company-jobs-heading"
        className={ADMIN_CARD}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 p-5 sm:px-7">
          <h2 id="company-jobs-heading" className="min-w-0 break-words text-xl font-bold text-foreground">
            {t('sectionJobs')}
          </h2>
          {company.jobsTotal > company.jobs.length ? (
            <p className="text-xs text-muted-foreground">
              {t('jobsShown', { shown: company.jobs.length, total: company.jobsTotal })}
            </p>
          ) : null}
        </div>
        {company.jobs.length === 0 ? (
          <p className="px-5 pb-6 text-sm text-muted-foreground sm:px-7">{t('jobsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {company.jobs.map((job) => (
              <li
                key={job.id}
                className="grid min-w-0 gap-1 p-5 text-sm sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center sm:gap-4 sm:px-7"
              >
                <p className="min-w-0 break-words font-semibold text-foreground">
                  {job.status === 'active' && job.slug ? (
                    <Link
                      href={`/oferty-pracy/${job.slug}`}
                      className="underline underline-offset-4 hover:no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                    >
                      {job.title || t('targetUnnamed')}
                    </Link>
                  ) : (
                    job.title || t('targetUnnamed')
                  )}
                </p>
                <span className="justify-self-start rounded-full bg-soft px-2.5 py-0.5 text-xs font-semibold text-foreground ring-1 ring-inset ring-border">
                  {t(JOB_STATUS_KEY[job.status] ?? 'statusUnknown')}
                </span>
                <span className="text-muted-foreground">{formatDate(job.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
