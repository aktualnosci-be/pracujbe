import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getTeamPageData } from '@/lib/data/team';
import { MyTeamInvitations } from '@/components/employer/team/MyTeamInvitations';
import { TeamInvite } from '@/components/employer/team/TeamInvite';
import { TeamMembers } from '@/components/employer/team/TeamMembers';
import { roleDescKey, roleLabelKey } from '@/components/employer/team/role-keys';

/**
 * Panel pracodawcy — Zespół (#403).
 *
 * owner/admin: lista członków (zmiana roli, odebranie/przywrócenie dostępu), zaproszenie po
 * e-mailu, oczekujące zaproszenia. recruiter/member: opis ich roli i informacja, kto zarządza
 * zespołem. Każdy widzi zaproszenia skierowane do siebie. Hierarchię egzekwuje baza (0087).
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
      <div className="max-w-4xl space-y-6">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <section role="alert" className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-foreground">{t('loadError')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">{t('loadErrorHint')}</p>
          <a
            href={`/${locale}/employer/zespol`}
            className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
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
    <div className="max-w-5xl space-y-6">
      <header className="min-w-0">
        <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          {data.companyName || t('title')}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">{t('title')}</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          {data.companyName ? t('subtitle', { company: data.companyName }) : t('subtitleGeneric')}
        </p>
      </header>

      {data.demo ? (
        <p className="rounded-md border border-border bg-soft p-3 text-sm text-foreground">{t('demoNotice')}</p>
      ) : null}

      <MyTeamInvitations invitations={myInvitations} />

      {data.members === null ? (
        <section className="rounded-3xl border border-border bg-card p-5 sm:p-7">
          <h2 className="text-lg font-semibold text-foreground">{t('notManagerTitle')}</h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {t('notManagerDesc', { role: t(roleLabelKey(data.activeRole)) })}
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{t(roleDescKey(data.activeRole))}</p>
        </section>
      ) : (
        <>
          <section aria-labelledby="team-members-title" className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-7">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="team-members-title" className="text-lg font-semibold text-foreground">
                {t('membersTitle')}
              </h2>
              <p className="text-sm text-muted-foreground">
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

          <section aria-labelledby="team-invite-title" className="space-y-4 rounded-3xl border border-border bg-card p-5 sm:p-7">
            <h2 id="team-invite-title" className="text-lg font-semibold text-foreground">
              {t('inviteTitle')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('inviteDesc')}</p>
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

      <section aria-labelledby="team-roles-title" className="rounded-3xl border border-border bg-card p-5 sm:p-7">
        <h2 id="team-roles-title" className="text-lg font-semibold text-foreground">
          {t('rolesTitle')}
        </h2>
        <dl className="mt-4 grid gap-4 sm:grid-cols-2">
          {ROLES.map((role) => (
            <div key={role} className="min-w-0">
              <dt className="font-semibold text-foreground">{t(roleLabelKey(role))}</dt>
              <dd className="mt-1 text-sm text-muted-foreground">{t(roleDescKey(role))}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
