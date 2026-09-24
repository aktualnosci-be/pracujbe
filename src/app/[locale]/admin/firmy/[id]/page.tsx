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
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';

/**
 * Panel administratora — szczegół firmy (#310).
 *
 * Decyzja o weryfikacji nie zapada „na ślepo”: dane rejestrowe (VAT, KBO, kontakt, adres),
 * uzasadnienie ostatniego odrzucenia/zawieszenia, członkowie firmy (rola, aktywny dostęp)
 * i najnowsze oferty. Akcje statusu te same co na liście (`CompanyStatusActions` → dialog
 * z wymaganym uzasadnieniem dla odrzucenia/zawieszenia → RPC 0085: powiadomienie i e-mail
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
      className="inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}

function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 whitespace-pre-line break-words text-sm text-foreground">{value}</dd>
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
        <AdminPageHeader title={t('companiesTitle')} subtitle={t('companyDetailSubtitle')} />
        <AdminLoadError retryHref={`/${locale}/admin/firmy/${encodeURIComponent(id)}`} />
      </div>
    );
  }

  if (result.status === 'not_found') {
    return (
      <div className="space-y-6">
        <BackLink label={t('backToCompanies')} />
        <AdminPageHeader title={t('companyNotFoundTitle')} subtitle={t('companyNotFoundHint')} />
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
      <AdminPageHeader title={company.name || t('nameFallback')} subtitle={t('companyDetailSubtitle')} />

      {/* Status i decyzja */}
      <section
        aria-labelledby="company-status-heading"
        className="space-y-4 rounded-lg border border-border bg-card p-4 sm:p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="company-status-heading" className="text-base font-semibold text-foreground">
            {t('sectionStatus')}
          </h2>
          <AdminStatusBadge kind="company" status={company.status} />
        </div>
        {company.statusReason ? (
          <div className="rounded-md bg-soft p-3 text-sm">
            <p className="font-medium text-muted-foreground">{t('statusReasonLabel')}</p>
            <p className="mt-1 whitespace-pre-line break-words text-foreground">
              {company.statusReason}
            </p>
          </div>
        ) : null}
        <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={t('colCreated')} value={formatDate(company.createdAt)} />
          <Field
            label={t('detailVerifiedAt')}
            value={company.verifiedAt ? formatDate(company.verifiedAt) : dash}
          />
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <CompanyStatusActions company={company} createdLabel={formatDate(company.createdAt)} />
          {historyId ? (
            <Link
              href={{ pathname: '/admin/dziennik', query: { entity: 'company', id: historyId } }}
              className="inline-flex min-h-11 items-center px-1 text-sm font-medium text-foreground underline underline-offset-2 hover:no-underline"
            >
              {t('auditHistoryLink')}
            </Link>
          ) : null}
        </div>
      </section>

      {/* Dane firmy */}
      <section
        aria-labelledby="company-data-heading"
        className="rounded-lg border border-border bg-card p-4 sm:p-5"
      >
        <h2 id="company-data-heading" className="text-base font-semibold text-foreground">
          {t('sectionCompanyData')}
        </h2>
        <dl className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
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
          <dl className="mt-4">
            <Field label={t('detailDescription')} value={company.description} />
          </dl>
        ) : null}
      </section>

      {/* Członkowie */}
      <section
        aria-labelledby="company-members-heading"
        className="rounded-lg border border-border bg-card"
      >
        <h2
          id="company-members-heading"
          className="p-4 text-base font-semibold text-foreground sm:px-5"
        >
          {t('sectionMembers')}
        </h2>
        {company.members.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">{t('membersEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {company.members.map((member) => (
              <li
                key={member.id}
                className="grid gap-1 p-4 text-sm sm:grid-cols-[1fr_auto] sm:items-center sm:gap-4 sm:px-5"
              >
                <div className="min-w-0">
                  <p className="break-words font-medium text-foreground">
                    {member.name || t('nameFallback')}
                  </p>
                  <p className="break-words text-muted-foreground">{member.email ?? dash}</p>
                </div>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {t(MEMBER_ROLE_KEY[member.role] ?? 'memberRoleMember')}
                  </span>
                  <span>{t(member.isActive ? 'memberActive' : 'memberInactive')}</span>
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
        className="rounded-lg border border-border bg-card"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-2 p-4 sm:px-5">
          <h2 id="company-jobs-heading" className="text-base font-semibold text-foreground">
            {t('sectionJobs')}
          </h2>
          {company.jobsTotal > company.jobs.length ? (
            <p className="text-xs text-muted-foreground">
              {t('jobsShown', { shown: company.jobs.length, total: company.jobsTotal })}
            </p>
          ) : null}
        </div>
        {company.jobs.length === 0 ? (
          <p className="px-4 pb-4 text-sm text-muted-foreground sm:px-5">{t('jobsEmpty')}</p>
        ) : (
          <ul className="divide-y divide-border border-t border-border">
            {company.jobs.map((job) => (
              <li
                key={job.id}
                className="grid gap-1 p-4 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center sm:gap-4 sm:px-5"
              >
                <p className="min-w-0 break-words font-medium text-foreground">
                  {job.status === 'active' && job.slug ? (
                    <Link
                      href={`/oferty-pracy/${job.slug}`}
                      className="underline underline-offset-2 hover:no-underline"
                    >
                      {job.title || t('targetUnnamed')}
                    </Link>
                  ) : (
                    job.title || t('targetUnnamed')
                  )}
                </p>
                <span className="text-muted-foreground">
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
