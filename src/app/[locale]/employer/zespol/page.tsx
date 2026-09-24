import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getTeamPageData } from '@/lib/data/team';
import { MyTeamInvitations } from '@/components/employer/team/MyTeamInvitations';
import { TeamInvite } from '@/components/employer/team/TeamInvite';
import { TeamMembers } from '@/components/employer/team/TeamMembers';
import { roleDescKey, roleLabelKey } from '@/components/employer/team/role-keys';
import {
  BTN_SECONDARY,
  DEMO_NOTE,
  EYEBROW,
  H1,
  INFO_PAIRS,
  INTRO,
  NOTICE,
  NOTICE_TEXT,
  NOTICE_TITLE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/**
 * Panel pracodawcy — Zespół (#403).
 *
 * owner/admin: lista członków (zmiana roli, odebranie/przywrócenie dostępu), zaproszenie po
 * e-mailu, oczekujące zaproszenia. recruiter/member: opis ich roli i informacja, kto zarządza
 * zespołem. Każdy widzi zaproszenia skierowane do siebie. Hierarchię egzekwuje baza (0086).
 *
 * NOINDEX (panel) + `force-dynamic` (dane z sesji). Błąd odczytu → komunikat z ponowieniem,
 * nigdy pusta lista zamiast danych. Bez env → dane demo z oznaczeniem.
 */

export const dynamic = 'force-dynamic';

const ROLES = ['owner', 'admin', 'recruiter', 'member'] as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'team' });
  return { title: t('title'), robots: { index: false, follow: false } };
}

function formatDate(iso: string, locale: string): string {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Europe/Brussels' }).format(date);
}

export default async function EmployerTeamPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: 'team' });
  const data = await getTeamPageData();

  if (data.status === 'error') {
    return (
      <div className="min-w-0 max-w-4xl space-y-[22px]">
        <h1 className={H1}>{t('title')}</h1>
        <section role="alert" className={NOTICE}>
          <div className="min-w-0">
            <h2 className={NOTICE_TITLE}>{t('loadError')}</h2>
            <p className={NOTICE_TEXT}>{t('loadErrorHint')}</p>
          </div>
          <a href={`/${locale}/employer/zespol`} className={BTN_SECONDARY}>
            {t('retry')}
          </a>
        </section>
      </div>
    );
  }

  const myInvitations = data.myInvitations.map((inv) => ({
    ...inv,
    expiresLabel: formatDate(inv.expiresAt, locale)
      ? t('expiresOn', { date: formatDate(inv.expiresAt, locale) })
      : '',
  }));

  return (
    <div className="min-w-0 max-w-5xl space-y-[22px]">
      <header className="min-w-0">
        <p className={EYEBROW}>{data.companyName || t('title')}</p>
        <h1 className={H1}>{t('title')}</h1>
        <p className={INTRO}>
          {data.companyName ? t('subtitle', { company: data.companyName }) : t('subtitleGeneric')}
        </p>
      </header>

      {data.demo ? (
        <p className={DEMO_NOTE}>{t('demoNotice')}</p>
      ) : null}

      <MyTeamInvitations invitations={myInvitations} />

      {data.members === null ? (
        <section className={PANEL}>
          <h2 className={PANEL_H2}>{t('notManagerTitle')}</h2>
          <p className={cn(PANEL_P, 'mt-2')}>
            {t('notManagerDesc', { role: t(roleLabelKey(data.activeRole)) })}
          </p>
          <p className={cn(PANEL_P, 'mt-2')}>{t(roleDescKey(data.activeRole))}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="team-members-title" className={PANEL}>
            <div className={SECTION_HEAD}>
              <h2 id="team-members-title" className={PANEL_H2}>
                {t('membersTitle')}
              </h2>
              <p className={PANEL_P}>
                {t('membersCount', { count: data.members.length })}
              </p>
            </div>
            <TeamMembers
              actorRole={data.activeRole}
              members={data.members.map((m) => ({
                id: m.id,
                name: m.name,
                email: m.email,
                role: m.role,
                isActive: m.isActive,
                isSelf: m.isSelf,
                sinceLabel: formatDate(m.joinedAt, locale)
                  ? t('since', { date: formatDate(m.joinedAt, locale) })
                  : '',
              }))}
            />
          </section>

          <section aria-labelledby="team-invite-title" className={cn(PANEL, 'space-y-4')}>
            <h2 id="team-invite-title" className={PANEL_H2}>
              {t('inviteTitle')}
            </h2>
            <p className={PANEL_P}>{t('inviteDesc')}</p>
            <TeamInvite
              actorRole={data.activeRole}
              invitations={data.invitations.map((inv) => ({
                id: inv.id,
                email: inv.email,
                role: inv.role,
                expiresLabel: formatDate(inv.expiresAt, locale)
                  ? t('expiresOn', { date: formatDate(inv.expiresAt, locale) })
                  : '',
              }))}
            />
          </section>
        </>
      )}

      <section aria-labelledby="team-roles-title" className={PANEL}>
        <h2 id="team-roles-title" className={PANEL_H2}>
          {t('rolesTitle')}
        </h2>
        <dl className={cn(INFO_PAIRS, 'pb-0 max-[600px]:grid-cols-1')}>
          {ROLES.map((role) => (
            <div key={role} className="min-w-0">
              <dt className={ROW_TITLE}>{t(roleLabelKey(role))}</dt>
              <dd className={ROW_META}>{t(roleDescKey(role))}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
