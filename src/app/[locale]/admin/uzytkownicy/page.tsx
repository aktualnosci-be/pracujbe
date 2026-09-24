import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import {
  normalizeAdminSearch,
  parseUserRoleFilter,
  USER_ROLE_FILTERS,
} from '@/lib/admin/list-params';
import { listUsers } from '@/lib/data/admin';
import { createAppDateFormatter } from '@/lib/datetime';
import { AdminLoadError } from '@/components/admin/AdminLoadError';
import {
  ADMIN_CARD,
  ADMIN_FIELD,
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import { cn } from '@/lib/utils';

/**
 * Panel administratora — Użytkownicy (Etap 7g).
 *
 * Lista kont (tylko odczyt): nazwa, e-mail, rola, data utworzenia (Europe/Brussels, #421).
 * Wyszukiwanie po imieniu/nazwisku/e-mailu, filtr roli i stronicowanie kursorem (#418),
 * parametry w URL (`?q=&role=&cursor=`). Odczyt service-rolem po
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

/** Ton wizualny roli (kolory tokenami; tekst na tincie → warianty `-text`, WCAG AA — #316). */
const ROLE_TONE: Record<string, string> = {
  candidate: 'bg-accent/10 text-accent-dark',
  employer: 'bg-primary/10 text-primary-dark',
  admin: 'bg-warning/10 text-warning-text',
  moderator: 'bg-success/10 text-success-text',
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

const BASE_PATH = '/admin/uzytkownicy';

type SearchParams = Record<string, string | string[] | undefined>;

function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AdminUsersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'admin' });
  const sp = await searchParams;
  const q = normalizeAdminSearch(firstValue(sp['q']));
  const role = parseUserRoleFilter(firstValue(sp['role']));
  const cursor = firstValue(sp['cursor']) ?? null;

  const result = await listUsers({ q, role, cursor });
  const users = result.status === 'ok' ? result.rows : [];
  const listQuery = { q, role };
  const retryParams = new URLSearchParams(
    Object.entries({ ...listQuery, cursor }).filter((e): e is [string, string] => Boolean(e[1])),
  ).toString();

  const formatDate = createAppDateFormatter(locale);
  const roleLabel = (role: string): string => {
    const key = ROLE_LABEL[role];
    return key ? t(key) : role;
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        eyebrow={t('brandTag')}
        title={t('usersTitle')}
        subtitle={t('usersSubtitle')}
      />

      <AdminSearchForm
        action={`/${locale}${BASE_PATH}`}
        q={q}
        label={t('searchUsersLabel')}
        hint={t('searchUsersHint')}
        clearHref={{ pathname: BASE_PATH, query: role ? { role } : {} }}
      >
        <div className="min-w-0 basis-40">
          <label htmlFor="admin-role" className="block text-sm font-semibold text-foreground">
            {t('colRole')}
          </label>
          <select
            id="admin-role"
            name="role"
            defaultValue={role ?? ''}
            className={ADMIN_FIELD}
          >
            <option value="">{t('roleAll')}</option>
            {USER_ROLE_FILTERS.map((value) => (
              <option key={value} value={value}>
                {roleLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </AdminSearchForm>

      {result.status === 'error' ? (
        <AdminLoadError retryHref={`/${locale}${BASE_PATH}${retryParams ? `?${retryParams}` : ''}`} />
      ) : (
        <section className={ADMIN_CARD}>
          {users.length === 0 ? (
            <AdminEmptyState message={t('usersEmpty')} />
          ) : (
            <>
              {/* Desktop: tabela */}
              <div className="hidden overflow-x-auto rounded-3xl md:block">
                <table className="w-full text-sm">
                  <thead className="bg-soft">
                    <tr className="border-b border-border text-left">
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('colUser')}
                      </th>
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('colEmail')}
                      </th>
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('colRole')}
                      </th>
                      <th scope="col" className="px-5 py-3 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                        {t('colCreated')}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td className="px-5 py-4 align-middle">
                          <div className="flex items-center gap-3">
                            <span
                              className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-soft text-xs font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                              aria-hidden="true"
                            >
                              {initials(user.name || t('nameFallback'))}
                            </span>
                            <span className="break-words font-semibold text-foreground">
                              {user.name || t('nameFallback')}
                            </span>
                          </div>
                        </td>
                        <td className="px-5 py-4 align-middle text-muted-foreground">
                          {user.email ?? '—'}
                        </td>
                        <td className="px-5 py-4 align-middle">
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium',
                              ROLE_TONE[user.role] ?? 'bg-muted text-muted-foreground',
                            )}
                          >
                            {roleLabel(user.role)}
                          </span>
                        </td>
                        <td className="px-5 py-4 align-middle text-muted-foreground">
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
                  <li key={user.id} className="flex min-w-0 items-start gap-3 p-5">
                    <span
                      className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                      aria-hidden="true"
                    >
                      {initials(user.name || t('nameFallback'))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <p className="min-w-0 break-words font-semibold text-foreground">
                          {user.name || t('nameFallback')}
                        </p>
                        <span
                          className={cn(
                            'max-w-full break-words rounded-full px-2 py-0.5 text-xs font-medium',
                            ROLE_TONE[user.role] ?? 'bg-muted text-muted-foreground',
                          )}
                        >
                          {roleLabel(user.role)}
                        </span>
                      </div>
                      {user.email ? (
                        <p className="mt-0.5 break-all text-sm text-muted-foreground">
                          {user.email}
                        </p>
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
      )}
      {result.status === 'ok' ? (
        <AdminPager
          pathname={BASE_PATH}
          query={listQuery}
          nextCursor={result.nextCursor}
          hasCursor={Boolean(cursor)}
          count={users.length}
          q={q}
        />
      ) : null}
    </div>
  );
}
