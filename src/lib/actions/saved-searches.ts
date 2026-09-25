'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { jsonArg, rpc, rpcRows } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Server Actions zapisanych wyszukiwań (#100) — cienka warstwa nad RPC z 0092.
 *
 * Kanonizacja filtrów, limit 20, brak duplikatów, rola kandydata i własność są w bazie
 * (`save_saved_search` / `set_saved_search_alerts` / `rename_saved_search` / `delete_saved_search`, wołane pod sesją
 * przez `withPortalTransaction`, #25); tu: walidacja
 * Zod kształtu wejścia + mapowanie błędu na kod użytkowy (Invariant #8). Tryb demo nic nie
 * zapisuje (`DEMO_UNAVAILABLE`) — bez udawanego sukcesu.
 */

const text100 = z.string().trim().min(1).max(100);
const list = z.array(z.string().trim().min(1).max(100)).max(50);

const filtersSchema = z
  .object({
    keyword: text100.optional(),
    city: text100.optional(),
    categories: list.optional(),
    locations: list.optional(),
    contractTypes: list.optional(),
    salaryMin: z.number().int().min(0).max(1_000_000).optional(),
    salaryMax: z.number().int().min(0).max(1_000_000).optional(),
    salaryUnit: z.literal('hour').optional(),
    accommodation: z.boolean().optional(),
    immediate: z.literal(true).optional(),
    noLanguage: z.literal(true).optional(),
  })
  .strict()
  .refine((f) => Object.keys(f).length > 0);

const saveSchema = z.object({
  name: z.string().trim().min(1).max(80),
  locale: z.enum(routing.locales),
  filters: filtersSchema,
  query: z.string().max(2000).regex(/^(\?.*)?$/),
});

const idSchema = z.string().uuid();
/** Te same reguły co w bazie (0108): 1–80 znaków po przycięciu, bez znaków sterujących. */
// eslint-disable-next-line no-control-regex
const nameSchema = z.string().trim().min(1).max(80).regex(/^[^\u0000-\u001f\u007f-\u009f]*$/);
const frequencySchema = z.enum(['daily', 'weekly']);

export type SaveSearchResult =
  | { ok: true; id: string; created: boolean }
  | { ok: false; error: ErrorCode | 'UNAUTHENTICATED' };
export type SavedSearchMutationResult = { ok: true } | { ok: false; error: ErrorCode };

function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('SAVED_SEARCH_LIMIT_REACHED')) return 'SAVED_SEARCH_LIMIT_REACHED';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (m.includes('PERMISSION_DENIED') || m.includes('UNAUTHENTICATED') || m.includes('permission denied')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

function revalidateSavedSearches(): void {
  for (const locale of routing.locales) revalidatePath(`/${locale}/candidate/wyszukiwania`);
}

/** Zapis wyszukiwania z listy ofert (idempotentnie: te same filtry → ten sam wiersz). */
export async function saveSearchAction(input: unknown): Promise<SaveSearchResult> {
  const parsed = saveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    // Bez sesji UI pokazuje link logowania (RPC odmówiłoby UNAUTHENTICATED).
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'UNAUTHENTICATED' };
    const rows = await withPortalTransaction(me, (tx) =>
      rpcRows<{ saved_search_id?: unknown; created?: unknown }>(tx, 'save_saved_search', {
        p_name: parsed.data.name,
        p_locale: parsed.data.locale,
        p_filters: jsonArg(parsed.data.filters),
        p_query: parsed.data.query,
        p_frequency: 'daily',
      }),
    );
    const row = rows[0];
    if (!row || typeof row.saved_search_id !== 'string') return { ok: false, error: 'INTERNAL' };
    revalidateSavedSearches();
    return { ok: true, id: row.saved_search_id, created: row.created === true };
  } catch (error) {
    if (isDatabaseError(error)) {
      const message = databaseErrorMessage(error);
      if (message.startsWith('UNAUTHENTICATED')) return { ok: false, error: 'UNAUTHENTICATED' };
      return { ok: false, error: mapPgError(message) };
    }
    captureError(error, { area: 'saved-searches.save' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Włączenie/wyłączenie alertu i zmiana częstotliwości digestu. */
export async function setSavedSearchAlertsAction(
  id: unknown,
  enabled: unknown,
  frequency: unknown,
): Promise<SavedSearchMutationResult> {
  const parsedId = idSchema.safeParse(id);
  const parsedEnabled = z.boolean().safeParse(enabled);
  const parsedFrequency = frequencySchema.safeParse(frequency);
  if (!parsedId.success || !parsedEnabled.success || !parsedFrequency.success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'set_saved_search_alerts', {
        p_saved_search_id: parsedId.data,
        p_enabled: parsedEnabled.data,
        p_frequency: parsedFrequency.data,
      }),
    );
    revalidateSavedSearches();
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'saved-searches.setAlerts' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Zmiana nazwy własnego wyszukiwania (#100). Cudze/nieistniejące → NOT_FOUND z bazy. */
export async function renameSavedSearchAction(id: unknown, name: unknown): Promise<SavedSearchMutationResult> {
  const parsedId = idSchema.safeParse(id);
  const parsedName = nameSchema.safeParse(name);
  if (!parsedId.success || !parsedName.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'rename_saved_search', { p_saved_search_id: parsedId.data, p_name: parsedName.data }),
    );
    revalidateSavedSearches();
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'saved-searches.rename' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Usunięcie własnego wyszukiwania (razem z historią alertów). */
export async function deleteSavedSearchAction(id: unknown): Promise<SavedSearchMutationResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isPortalDataConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'delete_saved_search', { p_saved_search_id: parsedId.data }),
    );
    revalidateSavedSearches();
    return { ok: true };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'saved-searches.delete' });
    return { ok: false, error: 'INTERNAL' };
  }
}
