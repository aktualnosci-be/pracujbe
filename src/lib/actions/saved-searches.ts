'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';

/**
 * Server Actions zapisanych wyszukiwań (#100) — cienka warstwa nad RPC z 0092.
 *
 * Kanonizacja filtrów, limit 20, brak duplikatów, rola kandydata i własność są w bazie
 * (`save_saved_search` / `set_saved_search_alerts` / `delete_saved_search`); tu: walidacja
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
  if (!isSupabaseConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('save_saved_search', {
      p_name: parsed.data.name,
      p_locale: parsed.data.locale,
      p_filters: parsed.data.filters,
      p_query: parsed.data.query,
      p_frequency: 'daily',
    });
    if (error) {
      // RPC rzuca UNAUTHENTICATED tylko bez sesji — wtedy UI pokazuje link logowania.
      if ((error.message ?? '').startsWith('UNAUTHENTICATED')) return { ok: false, error: 'UNAUTHENTICATED' };
      return { ok: false, error: mapPgError(error.message) };
    }
    const row = (Array.isArray(data) ? data[0] : data) as
      | { saved_search_id?: unknown; created?: unknown }
      | null
      | undefined;
    if (!row || typeof row.saved_search_id !== 'string') return { ok: false, error: 'INTERNAL' };
    revalidateSavedSearches();
    return { ok: true, id: row.saved_search_id, created: row.created === true };
  } catch (error) {
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
  if (!isSupabaseConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { error } = await supabase.rpc('set_saved_search_alerts', {
      p_saved_search_id: parsedId.data,
      p_enabled: parsedEnabled.data,
      p_frequency: parsedFrequency.data,
    });
    if (error) return { ok: false, error: mapPgError(error.message) };
    revalidateSavedSearches();
    return { ok: true };
  } catch (error) {
    captureError(error, { area: 'saved-searches.setAlerts' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/** Usunięcie własnego wyszukiwania (razem z historią alertów). */
export async function deleteSavedSearchAction(id: unknown): Promise<SavedSearchMutationResult> {
  const parsedId = idSchema.safeParse(id);
  if (!parsedId.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!isSupabaseConfigured()) return { ok: false, error: 'DEMO_UNAVAILABLE' };

  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { error } = await supabase.rpc('delete_saved_search', { p_saved_search_id: parsedId.data });
    if (error) return { ok: false, error: mapPgError(error.message) };
    revalidateSavedSearches();
    return { ok: true };
  } catch (error) {
    captureError(error, { area: 'saved-searches.delete' });
    return { ok: false, error: 'INTERNAL' };
  }
}
