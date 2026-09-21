import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { listUsers } from '@/lib/data/admin';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Użytkownicy (Etap 7g).
 *
 * Lista kont (tylko odczyt): nazwa, e-mail, rola, data utworzenia. Odczyt service-rolem po
 * potwierdzeniu roli admina w layoucie. NOINDEX + `force-dynamic` (dziedziczone z layoutu).
 */

export const dynamic = 'force-dynamic';

/** Etykieta roli (klucz i18n w namespace `admin`); brak w mapie → surowa wartość. */
const ROLE_LABEL: Record<string, string> = {
  candidate: 'roleCandidate',
  employer: 'roleEmployer',
  admin: 'roleAdmin',
  moderator: 'roleModerator',
};

/** Ton wizualny roli (kolory tokenami). */
const ROLE_TONE: Record<string, string> = {
  candidate: 'bg-accent/10 text-accent-dark',
  employer: 'bg-primary/10 text-primary-dark',
  admin: 'bg-warning/10 text-warning',
  moderator: 'bg-success/10 text-success',
};

/** Inicjały z nazwy (maks. 2 znaki). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'admin' });
  return {
    title: t('usersTitle'),
    robots: { index: false, follow: false },
  };
}

export default async function AdminUsersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const users = await listUsers();

  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: 'medium' });
  const formatDate = (iso: string | null): string => (iso ? dateFmt.format(new Date(iso)) : '—');
  const roleLabel = (role: string): string => {
    const key = ROLE_LABEL[role];
    return key ? t(key) : role;
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('usersTitle')}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t('usersSubtitle')}</p>
      </header>

      <section className="rounded-lg border border-border bg-card">
        {users.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{t('usersEmpty')}</p>
        ) : (
          <>
            {/* Desktop: tabela */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left">
                    <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                      {t('colUser')}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                      {t('colEmail')}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                      {t('colRole')}
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium text-muted-foreground">
                      {t('colCreated')}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {users.map((user) => (
                    <tr key={user.id}>
                      <td className="px-4 py-3 align-middle">
                        <div className="flex items-center gap-3">
                          <span
                            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                            aria-hidden="true"
                          >
                            {initials(user.name || t('nameFallback'))}
                          </span>
                          <span className="font-medium text-foreground">
                            {user.name || t('nameFallback')}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-middle text-muted-foreground">
                        {user.email ?? '—'}
                      </td>
                      <td className="px-4 py-3 align-middle">
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                            ROLE_TONE[user.role] ?? 'bg-muted text-muted-foreground',
                          )}
                        >
                          {roleLabel(user.role)}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-middle text-muted-foreground">
                        {formatDate(user.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: karty */}
            <ul className="divide-y divide-border md:hidden">
              {users.map((user) => (
                <li key={user.id} className="flex items-start gap-3 p-4">
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                    aria-hidden="true"
                  >
                    {initials(user.name || t('nameFallback'))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-medium text-foreground">
                        {user.name || t('nameFallback')}
                      </p>
                      <span
                        className={cn(
                          'shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
                          ROLE_TONE[user.role] ?? 'bg-muted text-muted-foreground',
                        )}
                      >
                        {roleLabel(user.role)}
                      </span>
                    </div>
                    {user.email ? (
                      <p className="mt-0.5 truncate text-sm text-muted-foreground">{user.email}</p>
                    ) : null}
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {formatDate(user.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
