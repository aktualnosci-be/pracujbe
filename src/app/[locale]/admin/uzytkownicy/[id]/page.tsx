import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { ArrowLeft } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { getUserDetail } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import { AdminPageHeader } from '@/components/admin/AdminListControls';
import { AdminStatusBadge } from '@/components/admin/AdminStatusBadge';
import {
  EMPTY,
  INLINE_LINK,
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
import { USER_ROLE_LABEL, USER_ROLE_TONE } from '@/components/admin/user-role';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — szczegół konta (tylko odczyt).
 *
 * Z listy `/admin/uzytkownicy` admin przechodzi do jednego konta: rola, e-mail, data
 * utworzenia, ostatnia aktywność, stan konta, język komunikacji wyznaczony jak w kolejce
 * e-mail (Invariant #1: preferowany → konto → rejestracja → en — z surowymi wartościami obok),
 * członkostwa w firmach (link do `/admin/firmy/[id]`), podsumowanie procesu kandydata (same
 * liczniki, bez treści zgłoszeń) i aktywna blokada adresu (#44, link do `/admin/poczta`).
 * Skrót „Działania tego konta w dzienniku” filtruje `/admin/dziennik` po wykonawcy.
 *
 * Strona niczego nie zmienia (brak akcji → brak wpisów audytu). Odczyt service-rolem po
 * potwierdzeniu roli admina (`getUserDetail` → `requireAdmin`). Nieistniejące/usunięte konto →
 * jawny stan „nie znaleziono”, błąd odczytu → stan błędu z ponowieniem. NOINDEX + `force-dynamic`.
 */

export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string; id: string }> };

const MEMBER_ROLE_KEY: Record<string, string> = {
  owner: 'memberRoleOwner',
  admin: 'memberRoleAdmin',
  recruiter: 'memberRoleRecruiter',
  member: 'memberRoleMember',
};

const LOCALE_KEY: Record<string, string> = {
  pl: 'breachLanguagePl',
  nl: 'breachLanguageNl',
  fr: 'breachLanguageFr',
  en: 'breachLanguageEn',
};

const SUPPRESSION_REASON_KEY: Record<string, string> = {
  hard_bounce: 'emailReasonHardBounce',
  complaint: 'emailReasonComplaint',
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('usersTitle'),
    robots: { index: false, follow: false },
  };
}

function BackLink({ label }: { label: string }) {
  return (
    <Link href="/admin/uzytkownicy" className={TEXT_LINK}>
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
      <dd className="mt-1.5 break-words text-[15px] font-semibold tracking-[-0.03em] text-foreground">
        {value}
      </dd>
    </div>
  );
}

export default async function AdminUserDetailPage({ params }: PageProps) {
  const { locale, id } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'admin' });
  const formatDate = createAppDateFormatter(locale);

  const result = await getUserDetail(id);

  if (result.status === 'error') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <BackLink label={t('backToUsers')} />
        <AdminPageHeader
          extended
          eyebrow={t('brandTag')}
          title={t('usersTitle')}
          subtitle={t('userDetailSubtitle')}
        />
        <AdminLoadError retryHref={`/${locale}/admin/uzytkownicy/${encodeURIComponent(id)}`} />
      </div>
    );
  }

  if (result.status === 'not_found') {
    return (
      <div className="min-w-0 space-y-[22px]">
        <BackLink label={t('backToUsers')} />
        <AdminPageHeader
          extended
          eyebrow={t('brandTag')}
          title={t('userNotFoundTitle')}
          subtitle={t('userNotFoundHint')}
        />
      </div>
    );
  }

  const user = result.user;
  const dash = '—';
  const roleKey = USER_ROLE_LABEL[user.role];
  const localeName = (value: string | null): string => {
    const key = value ? LOCALE_KEY[value] : undefined;
    return key ? t(key) : t('userLocaleUnset');
  };
  const yesNo = (value: boolean): string => t(value ? 'userYes' : 'userNo');

  return (
    <div className="min-w-0 space-y-[22px]">
      <BackLink label={t('backToUsers')} />
      <AdminPageHeader
        extended
        eyebrow={t('brandTag')}
        title={user.name || t('nameFallback')}
        subtitle={t('userDetailSubtitle')}
      />

      {/* Konto */}
      <section aria-labelledby="user-account-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="user-account-heading" className={PANEL_H2}>
            {t('sectionAccount')}
          </h2>
          <span className={cn(TAG, USER_ROLE_TONE[user.role])}>
            {roleKey ? t(roleKey) : user.role}
          </span>
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('colEmail')} value={user.email ?? dash} />
          <Field
            label={t('userStatusLabel')}
            value={t(user.isActive ? 'userActive' : 'userInactive')}
          />
          <Field label={t('colCreated')} value={formatDate(user.createdAt)} />
          <Field
            label={t('userLastSeen')}
            value={user.lastSeenAt ? formatDate(user.lastSeenAt) : t('userNeverSeen')}
          />
        </dl>
        {user.email ? (
          <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-border pt-5">
            <Link
              href={{ pathname: '/admin/dziennik', query: { actor: user.email } }}
              className={cn(TEXT_LINK, 'px-1 text-xs')}
            >
              {t('userAuditLink')}
            </Link>
          </div>
        ) : null}
      </section>

      {/* Język komunikacji (Invariant #1) */}
      <section aria-labelledby="user-language-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="user-language-heading" className={PANEL_H2}>
            {t('sectionLanguage')}
          </h2>
        </div>
        <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
          <Field label={t('userRecipientLocale')} value={localeName(user.recipientLocale)} />
          <Field label={t('userPreferredLocale')} value={localeName(user.preferredLocale)} />
          <Field label={t('userAccountLocale')} value={localeName(user.accountLocale)} />
          <Field label={t('userSignupLocale')} value={localeName(user.signupLocale)} />
        </dl>
        <p className={cn(PANEL_P, 'mt-5')}>{t('userRecipientLocaleHint')}</p>
      </section>

      {/* Adres e-mail — blokada (#44) */}
      <section aria-labelledby="user-email-heading" className={PANEL}>
        <div className={SECTION_HEAD}>
          <h2 id="user-email-heading" className={PANEL_H2}>
            {t('sectionUserEmail')}
          </h2>
        </div>
        <p className={PANEL_P}>
          {user.suppression
            ? t('userSuppressionActive', {
                reason: t(SUPPRESSION_REASON_KEY[user.suppression.reason] ?? 'emailReasonHardBounce'),
                date: formatDate(user.suppression.createdAt),
              })
            : t('userSuppressionNone')}
        </p>
        {user.suppression && user.email ? (
          <p className="mt-3">
            <Link
              href={{ pathname: '/admin/poczta', query: { q: user.email } }}
              className={cn(TEXT_LINK, 'px-1 text-xs')}
            >
              {t('userSuppressionLink')}
            </Link>
          </p>
        ) : null}
      </section>

      <div className="grid min-w-0 grid-cols-[1.4fr_1fr] gap-[19px] max-[1050px]:grid-cols-1">
        {/* Firmy */}
        <section aria-labelledby="user-companies-heading" className={PANEL}>
          <div className={SECTION_HEAD}>
            <h2 id="user-companies-heading" className={PANEL_H2}>
              {t('sectionUserCompanies')}
            </h2>
          </div>
          {user.memberships.length === 0 ? (
            <p className={EMPTY}>{t('userCompaniesEmpty')}</p>
          ) : (
            <ul>
              {user.memberships.map((membership) => (
                <li key={membership.id} className={ROW}>
                  <div className="min-w-0 flex-1">
                    <p className={ROW_TITLE}>
                      <Link
                        href={`/admin/firmy/${encodeURIComponent(membership.companyId)}`}
                        className={cn(INLINE_LINK, 'break-words')}
                      >
                        {membership.companyName || t('nameFallback')}
                      </Link>
                    </p>
                    <p className={ROW_META}>
                      {t('colMemberSince')}: {formatDate(membership.since)}
                    </p>
                    <div className="mt-1.5 flex flex-wrap items-center gap-[5px]">
                      <span className={TAG}>
                        {t(MEMBER_ROLE_KEY[membership.role] ?? 'memberRoleMember')}
                      </span>
                      <span
                        className={cn(
                          TAG,
                          membership.isActive ? 'bg-success/10 text-success-text' : undefined,
                        )}
                      >
                        {t(membership.isActive ? 'memberActive' : 'memberInactive')}
                      </span>
                      <AdminStatusBadge kind="company" status={membership.companyStatus} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Profil kandydata */}
        <section aria-labelledby="user-candidate-heading" className={PANEL}>
          <div className={SECTION_HEAD}>
            <h2 id="user-candidate-heading" className={PANEL_H2}>
              {t('sectionCandidate')}
            </h2>
          </div>
          {user.candidate ? (
            <dl className="grid grid-cols-1 gap-5 sm:grid-cols-2">
              <Field
                label={t('userProfileCompleted')}
                value={yesNo(user.candidate.profileCompleted)}
              />
              <Field label={t('userSearchable')} value={yesNo(user.candidate.isSearchable)} />
              <Field label={t('userApplications')} value={user.candidate.applications} />
              <Field label={t('userOffers')} value={user.candidate.offers} />
            </dl>
          ) : (
            <p className={EMPTY}>{t('userCandidateEmpty')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
