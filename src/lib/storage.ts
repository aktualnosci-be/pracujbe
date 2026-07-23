import 'server-only';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

/**
 * Dostęp do prywatnego magazynu plików (Supabase Storage) — Invariant #10:
 * pliki wrażliwe NIGDY przez publiczne buckety, wyłącznie przez SIGNED URLs o krótkim TTL.
 *
 * Bucket `candidate-files` jest prywatny (0018_storage.sql); polityki pozwalają operować
 * tylko na własnym folderze (`<auth.uid()>/...`). Podpisany URL generujemy pod sesją usera,
 * więc odczyt cudzych plików jest niemożliwy (RLS storage).
 */
export const CANDIDATE_BUCKET = 'candidate-files';

/** Domyślny TTL podpisanego URL: 60 s (wystarcza na pobranie, nie nadaje się do udostępniania). */
const DEFAULT_TTL_SECONDS = 60;

/**
 * Zwraca krótkotrwały signed URL do prywatnego pliku lub null (brak env / błąd / brak dostępu).
 * NIGDY nie rzuca do UI — błąd jest logowany, a wywołujący pokazuje neutralny stan.
 */
export async function getSignedFileUrl(
  path: string,
  bucket: string = CANDIDATE_BUCKET,
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

/**
 * Usuwa plik z prywatnego bucketa (pod sesją usera — RLS storage pilnuje własności).
 * Zwraca true/false (bez rzucania do UI).
 */
export async function removeFile(path: string, bucket: string = CANDIDATE_BUCKET): Promise<boolean> {
  if (!isSupabaseConfigured()) return true;
  try {
    const supabase = await createServerClient();
    const { error } = await supabase.storage.from(bucket).remove([path]);
    if (error) {
      captureError(error, { area: 'storage.removeFile', bucket });
      return false;
    }
    return true;
  } catch (error) {
    captureError(error, { area: 'storage.removeFile', bucket });
    return false;
  }
}
