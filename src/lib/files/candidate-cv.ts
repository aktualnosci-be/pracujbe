import 'server-only';

import {
  createOwnCandidateCv,
  deleteOwnCandidateCv,
  getOwnDownloadableCv,
  listOwnCandidateFiles,
  type CandidateFileListItem,
} from '@/lib/db/candidate-files';
import type { TransactionPool } from '@/lib/db/transaction';
import { AppError, isAppError, type ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/sentry';
import {
  createPrivateDownloadToken,
  verifyPrivateDownloadToken,
} from '@/lib/storage/private-download-token';
import { createCandidateCvKey, type createRailwayBucket } from '@/lib/storage/railway-bucket';
import { CV_ALLOWED_TYPES, checkCvFile, type CvFileProblem } from '@/lib/validation/cv-file';
import { attachmentDisposition, cvDisplayName, isValidCvContent } from './cv-content';

/**
 * Pliki CV kandydata na prywatnym buckecie Railway (#26, Invariant #10).
 *
 * Granica zaufania: `userId` pochodzi WYŁĄCZNIE z potwierdzonej sesji serwera (akcja/trasa),
 * klucz obiektu generuje serwer, a klient zna tylko ID rekordu `files`. Metadane czyta i
 * zapisuje repozytorium `db/candidate-files.ts` pod RLS (`withUserTransaction`); operacje S3
 * zawsze poza transakcją. Bucket jest prywatny — przeglądarka nigdy nie dostaje adresu S3,
 * tylko krótki (60 s) link aplikacji podpisany HMAC, który trasa pobrania weryfikuje razem
 * z bieżącą sesją, własnością i stanem skanu (kwarantanna: `pending`/`infected` = brak pobrania).
 *
 * Logi/Sentry dostają wyłącznie kod błędu — bez klucza, nazwy pliku i danych kandydata (#502).
 */

export type CvObjectStore = Pick<ReturnType<typeof createRailwayBucket>, 'put' | 'delete' | 'openStream'>;

export interface CvServiceDeps {
  pool: TransactionPool;
  store: CvObjectStore;
  /** `FILE_DOWNLOAD_SECRET` (min. 32 bajty). */
  downloadSecret: string;
  now?: () => number;
}

export interface CvUploadInput {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type CvUploadResult =
  | { ok: true; id: string }
  | { ok: false; error: ErrorCode; reason?: CvFileProblem };
export type CvSimpleResult = { ok: true } | { ok: false; error: ErrorCode };
export type CvDownloadLinkResult = { ok: true; url: string } | { ok: false; error: ErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const CV_DOWNLOAD_PATH = '/api/files/cv';
const DOWNLOAD_TTL_SECONDS = 60;

function repositoryError(error: unknown): ErrorCode {
  if (isAppError(error) && (error.code === 'PERMISSION_DENIED' || error.code === 'VALIDATION_FAILED')) {
    return error.code;
  }
  captureError(new AppError('INTERNAL'), { area: 'files.repository' });
  return 'INTERNAL';
}

/**
 * Sprzątanie obiektu bez metadanych (nieudany INSERT, niepewny PUT) albo po usuniętym rekordzie.
 * DELETE jest idempotentny; jedna ponowna próba tylko dla błędu przejściowego. Pozostała sierota
 * nie jest dostępna (brak rekordu = brak linku) — zgłaszamy sam kod do obserwacji.
 */
async function discardObject(store: CvObjectStore, key: string, area: string): Promise<boolean> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await store.delete({ key });
    if (result.ok) return true;
    if (!result.retryable) break;
  }
  captureError(new AppError('INTERNAL'), { area });
  return false;
}

/** Upload CV: walidacja bajtów → PUT pod losowym kluczem → INSERT metadanych pod RLS. */
export async function storeCandidateCv(
  deps: CvServiceDeps,
  userId: string,
  file: CvUploadInput,
): Promise<CvUploadResult> {
  const problem = checkCvFile(file);
  if (problem) return { ok: false, error: 'VALIDATION_FAILED', reason: problem };
  const ext = CV_ALLOWED_TYPES.get(file.type)!;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Rozmiar liczymy z odczytanych bajtów, nie z deklaracji klienta.
  const byteProblem = checkCvFile({ size: bytes.byteLength, type: file.type });
  if (byteProblem) return { ok: false, error: 'VALIDATION_FAILED', reason: byteProblem };
  if (!isValidCvContent(bytes, ext)) return { ok: false, error: 'VALIDATION_FAILED', reason: 'type' };

  let key: string;
  try {
    key = createCandidateCvKey(userId, ext);
  } catch {
    return { ok: false, error: 'PERMISSION_DENIED' };
  }
  const mimeType = file.type as Parameters<CvObjectStore['put']>[0]['contentType'];
  const put = await deps.store.put({ key, bytes, contentType: mimeType });
  if (!put.ok) {
    // Timeout/awaria: nie wiemy, czy obiekt powstał — sprzątamy ten sam klucz, bez sukcesu.
    if (put.error === 'TIMEOUT' || put.error === 'UNAVAILABLE' || put.error === 'CANCELLED') {
      await discardObject(deps.store, key, 'files.upload.uncertainPut');
    }
    captureError(new AppError('INTERNAL'), { area: 'files.upload.put' });
    return { ok: false, error: 'INTERNAL' };
  }

  try {
    const record = await createOwnCandidateCv(deps.pool, userId, {
      key,
      fileName: cvDisplayName(file.name, ext),
      mimeType,
      sizeBytes: put.value.sizeBytes,
      // AV odłożone (usługa zewnętrzna) → 'skipped' po walidacji treści; ze skanerem: 'pending'.
      scanStatus: 'skipped',
      checksumSha256: put.value.sha256,
    });
    return { ok: true, id: record.id };
  } catch (error) {
    await discardObject(deps.store, key, 'files.upload.orphan');
    return { ok: false, error: repositoryError(error) };
  }
}

/** Usunięcie: najpierw rekord (DELETE … RETURNING pod RLS), dopiero potem obiekt w buckecie. */
export async function removeCandidateCv(
  deps: CvServiceDeps,
  userId: string,
  fileId: string,
): Promise<CvSimpleResult> {
  if (typeof fileId !== 'string' || !UUID.test(fileId)) return { ok: false, error: 'NOT_FOUND' };
  let record;
  try {
    record = await deleteOwnCandidateCv(deps.pool, userId, fileId);
  } catch (error) {
    return { ok: false, error: repositoryError(error) };
  }
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  // Rekord już nie istnieje, więc obiektu nie da się pobrać; błąd sprzątania nie cofa sukcesu.
  await discardObject(deps.store, record.key, 'files.delete.object');
  return { ok: true };
}

/** Lista własnych CV (bez URL i klucza). Błąd rzuca — wywołujący pokazuje stan błędu, nie pustą listę. */
export async function listCandidateCvs(
  deps: CvServiceDeps,
  userId: string,
): Promise<CandidateFileListItem[]> {
  return listOwnCandidateFiles(deps.pool, userId);
}

/** Krótki (60 s) podpisany link aplikacji — tylko dla własnego pliku dopuszczonego do pobrania. */
export async function issueCvDownloadLink(
  deps: CvServiceDeps,
  userId: string,
  fileId: string,
): Promise<CvDownloadLinkResult> {
  if (typeof fileId !== 'string' || !UUID.test(fileId)) return { ok: false, error: 'NOT_FOUND' };
  let record;
  try {
    record = await getOwnDownloadableCv(deps.pool, userId, fileId);
  } catch (error) {
    return { ok: false, error: repositoryError(error) };
  }
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  const token = createPrivateDownloadToken(record.id, userId, {
    secret: deps.downloadSecret,
    now: deps.now,
    ttlSeconds: DOWNLOAD_TTL_SECONDS,
  });
  return { ok: true, url: `${CV_DOWNLOAD_PATH}/${record.id}?t=${encodeURIComponent(token)}` };
}

const NO_STORE = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

/** Odpowiedź bez treści: nie rozróżniamy „cudzy”, „usunięty”, „w kwarantannie” i „zły podpis”. */
export function emptyDownloadResponse(status: 404 | 503): Response {
  return new Response(null, { status, headers: NO_STORE });
}

/**
 * Pobranie przez trasę aplikacji (proxy strumienia z bucketu). Wymaga ważnego podpisu dla TEJ
 * sesji i TEGO pliku oraz ponownej kontroli rekordu w bazie — usunięcie rekordu albo
 * kwarantanna od razu unieważnia wcześniej wystawiony link.
 */
export async function openCvDownload(
  deps: CvServiceDeps,
  userId: string,
  fileId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  if (
    typeof fileId !== 'string' ||
    !UUID.test(fileId) ||
    !verifyPrivateDownloadToken(token, fileId, userId, { secret: deps.downloadSecret, now: deps.now })
  ) {
    return emptyDownloadResponse(404);
  }
  let record;
  try {
    record = await getOwnDownloadableCv(deps.pool, userId, fileId);
  } catch (error) {
    return emptyDownloadResponse(repositoryError(error) === 'INTERNAL' ? 503 : 404);
  }
  if (!record) return emptyDownloadResponse(404);

  const opened = await deps.store.openStream({ key: record.key, signal });
  if (!opened.ok) {
    captureError(new AppError('INTERNAL'), { area: 'files.download.open' });
    return emptyDownloadResponse(opened.error === 'NOT_FOUND' ? 404 : 503);
  }
  const { body, contentLength, contentType, close } = opened.value;
  // Obiekt musi odpowiadać autoryzowanym metadanym (rozmiar i typ) — inaczej nic nie wysyłamy.
  if (contentLength !== record.sizeBytes || contentType !== record.mimeType) {
    await close();
    captureError(new AppError('INTERNAL'), { area: 'files.download.mismatch' });
    return emptyDownloadResponse(503);
  }
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': record.mimeType,
      'content-length': String(contentLength),
      'content-disposition': attachmentDisposition(record.fileName),
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
