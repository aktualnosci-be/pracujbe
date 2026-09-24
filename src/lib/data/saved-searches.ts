/**
 * Zapisane wyszukiwania kandydata (#100) — odczyt POD SESJĄ (RLS `saved_searches_select_own`,
 * 0093; nigdy service-role). Błąd odczytu = jawny `error` (bez udawania pustej listy);
 * technikalia wyłącznie do Sentry (Invariant #8). Tryb demo: pusta lista z `demo: true` —
 * zapis wymaga bazy, więc nie pokazujemy zmyślonych wyszukiwań.
 */

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

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
  if (!isSupabaseConfigured()) return { status: 'ready', searches: [], demo: true };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data, error } = await supabase
      .from('saved_searches')
      .select('id, name, query, frequency, alerts_enabled, last_alert_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20);
    if (error) throw error;
    const searches = (Array.isArray(data) ? data : [])
      .map(mapSavedSearchRow)
      .filter((s): s is SavedSearch => s !== null);
    return { status: 'ready', searches, demo: false };
  } catch (error) {
    captureError(error, { area: 'saved-searches.load' });
    return { status: 'error' };
  }
}
