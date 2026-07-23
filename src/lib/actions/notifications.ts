'use server';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Server Actions powiadomień in-app — Pracuj.be (Etap 6).
 *
 * Cienka warstwa nad RPC `mark_notifications_read` (0016, SECURITY DEFINER, tylko własne
 * powiadomienia). Tu: guard trybu demo + wywołanie RPC + mapowanie błędu na kod użytkowy
 * (bez technikaliów, Invariant #8). Zapis idzie POD SESJĄ usera (RLS), nie przez service-role.
 */

export type MarkReadResult = { ok: true; count: number } | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/**
 * Oznacza powiadomienia jako przeczytane. `ids` puste/pominięte → wszystkie własne
 * nieprzeczytane. Zwraca liczbę zaktualizowanych rekordów. Bez env → `{ ok: true, count: 0 }`.
 */
export async function markNotificationsRead(ids?: string[]): Promise<MarkReadResult> {
  if (!isSupabaseConfigured()) return { ok: true, count: 0 };

  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('mark_notifications_read', {
      p_ids: ids && ids.length ? ids : null,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };

    const count = typeof data === 'number' ? data : Number(data);
    return { ok: true, count: Number.isFinite(count) ? count : 0 };
  } catch (error) {
    captureError(error, { area: 'notifications.markNotificationsRead' });
    return { ok: false, error: 'INTERNAL' };
  }
}
