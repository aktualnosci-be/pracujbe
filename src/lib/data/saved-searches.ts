/**
 * Zapisane wyszukiwania kandydata (#100) — odczyt POD SESJĄ (`withPortalTransaction`, RLS
 * `saved_searches_select_own`, 0092; nigdy service-role). Błąd odczytu = jawny `error` (bez udawania pustej listy);
 * technikalia wyłącznie do kanału błędów (Invariant #8). Tryb demo: pusta lista z `demo: true` —
 * zapis wymaga bazy, więc nie pokazujemy zmyślonych wyszukiwań.
 */

import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';

export type SavedSearchFrequency = 'daily' | 'weekly';

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
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
  return {
    id,
    name: asStr(r['name']),
    query: safeQuery(r['query']),
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
        `SELECT id, name, query, frequency, alerts_enabled, last_alert_at, created_at
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
