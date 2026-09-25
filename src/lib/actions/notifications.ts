'use server';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';

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
  if (!isPortalDataConfigured()) return { ok: true, count: 0 };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'mark_notifications_read', { p_ids: ids && ids.length ? ids : null }),
    );
    const count = typeof data === 'number' ? data : Number(data);
    return { ok: true, count: Number.isFinite(count) ? count : 0 };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'notifications.markNotificationsRead' });
    return { ok: false, error: 'INTERNAL' };
  }
}
