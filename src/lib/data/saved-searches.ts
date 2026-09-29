/**
 * Zapisane wyszukiwania kandydata (#100) — odczyt POD SESJĄ (`withPortalTransaction`, RLS
 * `saved_searches_select_own`, 0092; nigdy service-role). Błąd odczytu = jawny `error` (bez udawania pustej listy);
 * technikalia wyłącznie do kanału błędów (Invariant #8). Tryb demo: pusta lista z `demo: true` —
 * zapis wymaga bazy, więc nie pokazujemy zmyślonych wyszukiwań.
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows, rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { isLocale, routing, type Locale } from '@/i18n/routing';

export type SavedSearchFrequency = 'daily' | 'weekly';

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
  /**
   * Język zapisany razem z wyszukiwaniem (#823) — worker alertów dopasowuje słowo kluczowe
   * do tłumaczenia w TYM języku (0092), więc „Pokaż oferty” musi otworzyć listę pod tym samym
   * locale, a nie pod aktualnym językiem panelu. Nieobsługiwana/pusta wartość z bazy →
   * bezpieczny fallback do domyślnego locale (routing.defaultLocale), nigdy dowolny ciąg.
   */
  locale: Locale;
  frequency: SavedSearchFrequency;
  alertsEnabled: boolean;
  lastAlertAt: string | null;
  createdAt: string;
}

export type SavedSearchesLoad =
  | { status: 'ready'; searches: SavedSearch[]; demo: boolean }
  | { status: 'error' };

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Adres listy zapisany w bazie zaczyna się od `?` (albo jest pusty) — nic innego nie linkujemy. */
function safeQuery(value: unknown): string {
  const q = asStr(value);
  return q.startsWith('?') && q.length <= 2000 ? q : '';
}

export function mapSavedSearchRow(row: unknown): SavedSearch | null {
  const r = typeof row === 'object' && row !== null ? (row as Record<string, unknown>) : {};
  const id = asStr(r['id']);
  if (!id) return null;
  const rawLocale = r['locale'];
  return {
    id,
    name: asStr(r['name']),
    query: safeQuery(r['query']),
    locale: isLocale(rawLocale) ? rawLocale : routing.defaultLocale,
    frequency: r['frequency'] === 'weekly' ? 'weekly' : 'daily',
    alertsEnabled: r['alerts_enabled'] === true,
    lastAlertAt: asStr(r['last_alert_at']) || null,
    createdAt: asStr(r['created_at']),
  };
}

export async function loadMySavedSearches(): Promise<SavedSearchesLoad> {
  if (!isPortalDataConfigured()) return { status: 'ready', searches: [], demo: true };

  try {
    const me = await getPortalIdentity();
    // Bez sesji RLS i tak nie zwróci żadnego wiersza — nie pytamy bazy.
    if (!me) return { status: 'ready', searches: [], demo: false };
    const rows = await withPortalTransaction(me, (tx) =>
      queryRows(tx, 'saved-searches.mine',
        `SELECT id, name, query, locale, frequency, alerts_enabled, last_alert_at, created_at
           FROM public.saved_searches
          WHERE profile_id = $1
          ORDER BY created_at DESC
          LIMIT 20`, [me.id]),
    );
    const searches = rows
      .map(mapSavedSearchRow)
      .filter((s): s is SavedSearch => s !== null);
    return { status: 'ready', searches, demo: false };
  } catch (error) {
    captureError(error, { area: 'saved-searches.load' });
    return { status: 'error' };
  }
}

/**
 * Czasowa pauza alertów konta (#810, 0969) — odczyt pod sesją (RLS `saved_search_alert_pauses_select_own`).
 * `pausedUntil` = koniec TRWAJĄCEJ pauzy (ISO) albo null (brak/zakończona). Błąd odczytu = jawny `error`,
 * nie „brak pauzy” (kandydat nie może uznać, że alerty działają, gdy nie znamy stanu).
 */
export type AlertsPauseLoad =
  | { status: 'ready'; pausedUntil: string | null }
  | { status: 'error' };

export async function loadMyAlertsPause(): Promise<AlertsPauseLoad> {
  if (!isPortalDataConfigured()) return { status: 'ready', pausedUntil: null };
  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'ready', pausedUntil: null };
    const rows = await withPortalTransaction(me, (tx) =>
      queryRows(tx, 'saved-searches.pause',
        `SELECT paused_until
           FROM public.saved_search_alert_pauses
          WHERE profile_id = $1 AND paused_until > now()`, [me.id]),
    );
    const raw = (rows[0] as Record<string, unknown> | undefined)?.['paused_until'];
    const iso = raw instanceof Date ? raw.toISOString() : typeof raw === 'string' ? raw : '';
    return { status: 'ready', pausedUntil: iso && !Number.isNaN(new Date(iso).getTime()) ? iso : null };
  } catch (error) {
    captureError(error, { area: 'saved-searches.pause.load' });
    return { status: 'error' };
  }
}

/**
 * Obserwowane firmy kandydata (#855, 0969): wyszukiwania z kluczem firmy → adres profilu.
 * Klucz mapy = id wyszukiwania; `slug` null = profil niedostępny (firma niezweryfikowana/usunięta).
 * Awaria odczytu nie blokuje listy — wyszukiwania pokazują się bez odnośnika do profilu.
 */
export async function loadMyFollowedCompanies(): Promise<Map<string, { slug: string | null }>> {
  const out = new Map<string, { slug: string | null }>();
  if (!isPortalDataConfigured()) return out;
  try {
    const me = await getPortalIdentity();
    if (!me) return out;
    const rows = await withPortalTransaction(me, (tx) => rpcRows(tx, 'get_my_followed_companies', {}));
    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const id = asStr(r['saved_search_id']);
      if (!id) continue;
      out.set(id, { slug: asStr(r['company_slug']) || null });
    }
  } catch (error) {
    captureError(error, { area: 'saved-searches.followed.load' });
  }
  return out;
}
