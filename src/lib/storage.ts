import 'server-only';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Supabase Storage — pozostałość WYŁĄCZNIE dla PDF faktur (billing wyłączony, #51).
 * CV kandydata NIE przechodzą tędy: upload/pobranie/usunięcie idą przez prywatny bucket
 * Railway (`src/lib/files/*`, #26). Nie używaj tego modułu dla nowych plików; domknięcie
 * billing = osobne zadanie (docs/railway/STORAGE_ADAPTER_CONTRACT.md).
 * Invariant #10: tylko SIGNED URLs o krótkim TTL, pod sesją użytkownika (RLS storage).
 */

/** Domyślny TTL podpisanego URL: 60 s (wystarcza na pobranie, nie nadaje się do udostępniania). */
const DEFAULT_TTL_SECONDS = 60;

/**
 * Zwraca krótkotrwały signed URL do prywatnego pliku lub null (brak env / błąd / brak dostępu).
 * NIGDY nie rzuca do UI — błąd jest logowany, a wywołujący pokazuje neutralny stan.
 */
export async function getSignedFileUrl(
  path: string,
  bucket: string,
  ttlSeconds: number = DEFAULT_TTL_SECONDS,
): Promise<string | null> {
  if (!isSupabaseConfigured()) return null;
  try {
    const supabase = await createServerClient();
    const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, ttlSeconds);
    if (error) {
      captureError(error, { area: 'storage.getSignedFileUrl', bucket });
      return null;
    }
    return data?.signedUrl ?? null;
  } catch (error) {
    captureError(error, { area: 'storage.getSignedFileUrl', bucket });
    return null;
  }
}
