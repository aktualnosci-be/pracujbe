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
  AdminEmptyState,
  AdminPageHeader,
  AdminPager,
  AdminSearchForm,
} from '@/components/admin/AdminListControls';
import {
  FIELD,
  FIELD_LABEL,
  ICON_BOX,
  PANEL,
  ROW,
  ROW_META,
  ROW_TITLE,
  TABLE_WRAP,
  TAG,
  TD,
  TD_WRAP,
  TH,
} from '@/components/admin/admin-styles';
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
    <div className="min-w-0 space-y-[22px]">
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
        <div className="min-w-0 basis-40 p-1">
          <label htmlFor="admin-role" className={FIELD_LABEL}>
            {t('colRole')}
          </label>
          <select
            id="admin-role"
            name="role"
            defaultValue={role ?? ''}
            className={FIELD}
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
        <section className={PANEL}>
          {users.length === 0 ? (
            <AdminEmptyState message={t('usersEmpty')} />
          ) : (
            <>
              {/* Desktop: tabela */}
              <div className={cn(TABLE_WRAP, 'hidden md:block')}>
                <table className="w-full border-collapse">
                  <thead>
                    <tr>
                      <th scope="col" className={TH}>
                        {t('colUser')}
                      </th>
                      <th scope="col" className={TH}>
                        {t('colEmail')}
                      </th>
                      <th scope="col" className={TH}>
                        {t('colRole')}
                      </th>
                      <th scope="col" className={TH}>
                        {t('colCreated')}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.id}>
                        <td className={TD_WRAP}>
                          <div className="flex items-center gap-3">
                            <span className={cn(ICON_BOX, 'size-9')} aria-hidden="true">
                              {initials(user.name || t('nameFallback'))}
                            </span>
                            <span className="break-words font-semibold">
                              {user.name || t('nameFallback')}
                            </span>
                          </div>
                        </td>
                        <td className={TD}>
                          {user.email ?? '—'}
                        </td>
                        <td className={TD}>
                          <span className={cn(TAG, ROLE_TONE[user.role])}>
                            {roleLabel(user.role)}
                          </span>
                        </td>
                        <td className={TD}>
                          {formatDate(user.createdAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile: karty */}
              <ul className="md:hidden">
                {users.map((user) => (
                  <li key={user.id} className={ROW}>
                    <span className={ICON_BOX} aria-hidden="true">
                      {initials(user.name || t('nameFallback'))}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={ROW_TITLE}>{user.name || t('nameFallback')}</p>
                      {user.email ? (
                        <p className={cn(ROW_META, 'break-all')}>{user.email}</p>
                      ) : null}
                      <p className={ROW_META}>{formatDate(user.createdAt)}</p>
                      <span className={cn(TAG, 'mt-1.5', ROLE_TONE[user.role])}>
                        {roleLabel(user.role)}
                      </span>
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
