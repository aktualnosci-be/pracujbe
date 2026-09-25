import 'server-only';

import { fileBucketConfig, fileDownloadSecret, isFileStorageConfigured } from '@/lib/env';
import type { TransactionPool } from '@/lib/db/transaction';
import { createRailwayBucket } from '@/lib/storage/railway-bucket';
import type { CvObjectStore, CvServiceDeps } from './candidate-cv';

/**
 * Zależności runtime plików kandydata (#26): pula ograniczonego loginu aplikacji, jeden
 * prywatny bucket Railway ze zmiennych serwera i sekret linków pobrania. `null` = brak
 * kompletnej konfiguracji (wywołujący: demo poza produkcją, fail-closed w produkcji).
 */
let store: CvObjectStore | undefined;

export async function getCvServiceDeps(): Promise<CvServiceDeps | null> {
  const config = fileBucketConfig();
  const secret = fileDownloadSecret();
  if (!isFileStorageConfigured() || !config || !secret) return null;
  const { getDomainPool } = await import('@/lib/db/runtime');
  const pool = await getDomainPool();
  store ??= createRailwayBucket(config);
  return { pool, store, downloadSecret: secret };
}

/** Te same zasoby dla załączników wiadomości (0119): jeden prywatny bucket i sekret linków. */
export async function getAttachmentServiceDeps(): Promise<
  import('./message-attachments').AttachmentServiceDeps | null
> {
  return getCvServiceDeps();
}

/**
 * Zalogowany użytkownik (dowolna rola) z potwierdzonej sesji dla nagłówków BIEŻĄCEGO żądania —
 * trasa pobrania załącznika; dostęp do rozmowy rozstrzyga baza. Awaria rzuca.
 */
export async function readSessionUserId(
  pool: TransactionPool,
  requestHeaders: Headers,
): Promise<string | null> {
  const [{ getAuthRuntime }, { readPortalIdentity }] = await Promise.all([
    import('@/lib/auth/runtime'),
    import('@/lib/auth/session'),
  ]);
  const identity = await readPortalIdentity(await getAuthRuntime(), pool, requestHeaders);
  return identity?.id ?? null;
}

export type CandidateSession =
  | { status: 'candidate'; id: string }
  | { status: 'anonymous' }
  | { status: 'forbidden' };

/**
 * Kandydat z potwierdzonej sesji Better Auth (aktywny profil, zweryfikowany e-mail) dla
 * nagłówków BIEŻĄCEGO żądania. Rola z bazy, nie z cookie. Awaria rzuca — wywołujący
 * odpowiada błędem, nigdy anonimowym sukcesem.
 */
export async function readCandidateSession(
  pool: TransactionPool,
  requestHeaders: Headers,
): Promise<CandidateSession> {
  const [{ getAuthRuntime }, { readPortalIdentity }] = await Promise.all([
    import('@/lib/auth/runtime'),
    import('@/lib/auth/session'),
  ]);
  const identity = await readPortalIdentity(await getAuthRuntime(), pool, requestHeaders);
  if (!identity) return { status: 'anonymous' };
  return identity.role === 'candidate' ? { status: 'candidate', id: identity.id } : { status: 'forbidden' };
}
