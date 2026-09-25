import 'server-only';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { rpc, rpcRows } from '@/lib/db/sql';
import { withUserTransaction, type TransactionPool } from '@/lib/db/transaction';
import { AppError, type ErrorCode } from '@/lib/errors';
import { captureError } from '@/lib/error-report';
import {
  createPrivateDownloadToken,
  verifyPrivateDownloadToken,
} from '@/lib/storage/private-download-token';
import { createMessageAttachmentKey, type createRailwayBucket } from '@/lib/storage/railway-bucket';
import {
  ATTACHMENT_ALLOWED_TYPES,
  checkAttachmentFile,
  type AttachmentExtension,
  type AttachmentFileProblem,
} from '@/lib/validation/message-attachment';
import { attachmentDisposition, isValidCvContent } from './cv-content';

/**
 * Załączniki wiadomości na prywatnym buckecie Railway (0119, Invariant #10).
 *
 * Granica zaufania: `userId` wyłącznie z potwierdzonej sesji serwera; klucz obiektu nadaje
 * serwer (`<rozmowa>/att-<uuid>.<ext>`); klient zna tylko ID załącznika. Dostęp do rozmowy,
 * blokadę firmy (#97), idempotencję i kwarantannę rozstrzyga baza (RPC 0119) pod RLS
 * (`withUserTransaction`); operacje S3 zawsze poza transakcją.
 *
 * Kolejność uploadu: kontrola dostępu → PUT → `stage_message_attachment`. Ponowienie z tym samym
 * `clientUploadId` zwraca istniejący załącznik, a zbędny nowy obiekt jest usuwany. Wysłanie
 * łączy załączniki z wiadomością w `send_message` (ta sama transakcja co wiadomość).
 * Pobranie = krótki (60 s) link HMAC do trasy aplikacji, która PONOWNIE sprawdza sesję,
 * członkostwo w rozmowie i stan skanu, a bajty strumieniuje z bucketu (bez adresu S3).
 *
 * Logi/kanał błędów dostają wyłącznie kod błędu — bez klucza, nazwy pliku i treści (#502).
 */

export type AttachmentObjectStore = Pick<ReturnType<typeof createRailwayBucket>, 'put' | 'delete' | 'openStream'>;

export interface AttachmentServiceDeps {
  pool: TransactionPool;
  store: AttachmentObjectStore;
  /** `FILE_DOWNLOAD_SECRET` (min. 32 bajty); linki załączników podpisujemy kluczem pochodnym. */
  downloadSecret: string;
  now?: () => number;
}

export interface AttachmentUploadInput {
  name: string;
  type: string;
  size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
}

export type AttachmentUploadResult =
  | { ok: true; id: string }
  | { ok: false; error: ErrorCode; reason?: AttachmentFileProblem };
export type AttachmentLinkResult = { ok: true; url: string } | { ok: false; error: ErrorCode };
export type AttachmentSimpleResult = { ok: true } | { ok: false; error: ErrorCode };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const ATTACHMENT_DOWNLOAD_PATH = '/api/files/message';
const DOWNLOAD_TTL_SECONDS = 60;

/** Separacja domen podpisu: link CV nie jest ważny dla trasy załączników i odwrotnie. */
function attachmentSecret(secret: string): string {
  return `${secret}:message-attachment`;
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

/** Błąd bazy → kod użytkowy (Invariant #8); inny wyjątek → kanał błędów + INTERNAL. */
function repositoryError(error: unknown, area: string): ErrorCode {
  if (isDatabaseError(error)) {
    const message = databaseErrorMessage(error);
    if (message.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
    if (
      message.includes('PERMISSION_DENIED') ||
      message.includes('UNAUTHENTICATED') ||
      message.includes('permission denied')
    ) {
      return 'PERMISSION_DENIED';
    }
  }
  captureError(new AppError('INTERNAL'), { area });
  return 'INTERNAL';
}

/** DELETE jest idempotentny; jedna ponowna próba dla błędu przejściowego. */
async function discardObject(store: AttachmentObjectStore, key: string, area: string): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const result = await store.delete({ key });
    if (result.ok) return;
    if (!result.retryable) break;
  }
  captureError(new AppError('INTERNAL'), { area });
}

/** Dozwolony typ i sygnatura treści (MIME klienta jest niezaufany). */
export function isValidAttachmentContent(bytes: Uint8Array, ext: AttachmentExtension): boolean {
  if (ext === 'jpg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === 'png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((byte, i) => bytes[i] === byte);
  }
  return isValidCvContent(bytes, ext);
}

/** Nazwa pokazywana w wątku i w nagłówku pobrania: bez znaków sterujących, ≤ 200 znaków. */
export function attachmentDisplayName(name: string, ext: AttachmentExtension): string {
  const cleaned = Array.from(name.replace(/[\x00-\x1f\x7f]/g, '').trim()).slice(0, 200).join('').trim();
  return cleaned || `file.${ext}`;
}

/** Upload: walidacja bajtów → kontrola dostępu → PUT → metadane w bazie (idempotentnie). */
export async function storeMessageAttachment(
  deps: AttachmentServiceDeps,
  userId: string,
  conversationId: string,
  clientUploadId: string,
  file: AttachmentUploadInput,
): Promise<AttachmentUploadResult> {
  if (!isUuid(conversationId) || !isUuid(clientUploadId)) return { ok: false, error: 'VALIDATION_FAILED' };
  const problem = checkAttachmentFile(file);
  if (problem) return { ok: false, error: 'VALIDATION_FAILED', reason: problem };
  const ext = ATTACHMENT_ALLOWED_TYPES.get(file.type)!;
  const bytes = new Uint8Array(await file.arrayBuffer());
  // Rozmiar liczymy z odczytanych bajtów, nie z deklaracji klienta.
  const byteProblem = checkAttachmentFile({ size: bytes.byteLength, type: file.type });
  if (byteProblem) return { ok: false, error: 'VALIDATION_FAILED', reason: byteProblem };
  if (!isValidAttachmentContent(bytes, ext)) return { ok: false, error: 'VALIDATION_FAILED', reason: 'type' };

  // Bez dostępu do rozmowy nie zapisujemy żadnych bajtów w buckecie.
  try {
    const allowed = await withUserTransaction(deps.pool, userId, (tx) =>
      rpc<boolean>(tx, 'can_attach_in_conversation', { p_conversation_id: conversationId }));
    if (allowed !== true) return { ok: false, error: 'PERMISSION_DENIED' };
  } catch (error) {
    return { ok: false, error: repositoryError(error, 'attachments.upload.access') };
  }

  let key: string;
  try {
    key = createMessageAttachmentKey(conversationId, ext);
  } catch {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }
  const contentType = file.type as Parameters<AttachmentObjectStore['put']>[0]['contentType'];
  const put = await deps.store.put({ key, bytes, contentType });
  if (!put.ok) {
    if (put.error === 'TIMEOUT' || put.error === 'UNAVAILABLE' || put.error === 'CANCELLED') {
      await discardObject(deps.store, key, 'attachments.upload.uncertainPut');
    }
    captureError(new AppError('INTERNAL'), { area: 'attachments.upload.put' });
    return { ok: false, error: 'INTERNAL' };
  }

  try {
    const rows = await withUserTransaction(deps.pool, userId, (tx) =>
      rpcRows<{ attachment_id: unknown; created: unknown }>(tx, 'stage_message_attachment', {
        p_conversation_id: conversationId,
        p_client_upload_id: clientUploadId,
        p_path: key,
        p_file_name: attachmentDisplayName(file.name, ext),
        p_mime_type: contentType,
        p_size_bytes: put.value.sizeBytes,
        p_checksum_sha256: put.value.sha256,
        // AV odłożone (usługa zewnętrzna) → 'skipped' po walidacji treści; ze skanerem: 'pending'.
        p_scan_status: 'skipped',
      }));
    const row = rows[0];
    if (!row || !isUuid(row.attachment_id)) {
      await discardObject(deps.store, key, 'attachments.upload.orphan');
      return { ok: false, error: repositoryError(new AppError('INTERNAL'), 'attachments.upload.result') };
    }
    // Ponowienie tej samej operacji: załącznik już istnieje, nowy obiekt jest zbędny.
    if (row.created !== true) await discardObject(deps.store, key, 'attachments.upload.duplicate');
    return { ok: true, id: row.attachment_id };
  } catch (error) {
    await discardObject(deps.store, key, 'attachments.upload.orphan');
    return { ok: false, error: repositoryError(error, 'attachments.upload.stage') };
  }
}

/** Rezygnacja z niewysłanego załącznika; obiekt usuwa kolejka storage (#486). */
export async function discardStagedAttachment(
  deps: AttachmentServiceDeps,
  userId: string,
  attachmentId: string,
): Promise<AttachmentSimpleResult> {
  if (!isUuid(attachmentId)) return { ok: false, error: 'NOT_FOUND' };
  try {
    const removed = await withUserTransaction(deps.pool, userId, (tx) =>
      rpc<boolean>(tx, 'discard_message_attachment', { p_attachment_id: attachmentId }));
    return removed === true ? { ok: true } : { ok: false, error: 'NOT_FOUND' };
  } catch (error) {
    return { ok: false, error: repositoryError(error, 'attachments.discard') };
  }
}

interface DownloadRecord {
  id: string;
  conversationId: string;
  key: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}

const EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
};

/** Rekord z bazy musi być spójny: klucz w rozmowie załącznika, MIME = rozszerzenie. */
function readDownloadRecord(value: unknown): DownloadRecord {
  const r = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const id = r['id'];
  const conversationId = r['conversation_id'];
  const key = r['path'];
  const fileName = r['file_name'];
  const mimeType = r['mime_type'];
  const sizeBytes = r['size_bytes'];
  if (
    !isUuid(id) || !isUuid(conversationId) || typeof key !== 'string' ||
    typeof fileName !== 'string' || !fileName || typeof mimeType !== 'string' ||
    typeof sizeBytes !== 'number' || !Number.isSafeInteger(sizeBytes) || sizeBytes < 1 ||
    !key.startsWith(`${conversationId}/att-`) ||
    EXTENSION_TYPES[key.slice(key.lastIndexOf('.') + 1)] !== mimeType
  ) {
    throw new AppError('INTERNAL');
  }
  return { id, conversationId, key, fileName, mimeType, sizeBytes };
}

async function findDownloadable(
  deps: AttachmentServiceDeps,
  userId: string,
  attachmentId: string,
): Promise<DownloadRecord | null> {
  const rows = await withUserTransaction(deps.pool, userId, (tx) =>
    rpcRows(tx, 'get_message_attachment_download', { p_attachment_id: attachmentId }));
  return rows[0] ? readDownloadRecord(rows[0]) : null;
}

/** Krótki (60 s) podpisany link aplikacji — tylko dla załącznika widocznego i poza kwarantanną. */
export async function issueAttachmentDownloadLink(
  deps: AttachmentServiceDeps,
  userId: string,
  attachmentId: string,
): Promise<AttachmentLinkResult> {
  if (!isUuid(attachmentId)) return { ok: false, error: 'NOT_FOUND' };
  let record: DownloadRecord | null;
  try {
    record = await findDownloadable(deps, userId, attachmentId);
  } catch (error) {
    return { ok: false, error: repositoryError(error, 'attachments.link') };
  }
  if (!record) return { ok: false, error: 'NOT_FOUND' };
  const token = createPrivateDownloadToken(record.id, userId, {
    secret: attachmentSecret(deps.downloadSecret),
    now: deps.now,
    ttlSeconds: DOWNLOAD_TTL_SECONDS,
  });
  return { ok: true, url: `${ATTACHMENT_DOWNLOAD_PATH}/${record.id}?t=${encodeURIComponent(token)}` };
}

const NO_STORE = {
  'cache-control': 'private, no-store',
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
} as const;

/** Odpowiedź bez treści: nie rozróżniamy „cudzy”, „usunięty”, „w kwarantannie” i „zły podpis”. */
export function emptyAttachmentResponse(status: 404 | 503): Response {
  return new Response(null, { status, headers: NO_STORE });
}

/**
 * Pobranie przez trasę aplikacji. Wymaga ważnego podpisu dla TEJ sesji i TEGO załącznika oraz
 * ponownej kontroli w bazie — utrata dostępu do rozmowy, blokada firmy, usunięcie albo
 * kwarantanna od razu unieważniają wcześniej wystawiony link.
 */
export async function openAttachmentDownload(
  deps: AttachmentServiceDeps,
  userId: string,
  attachmentId: string,
  token: string,
  signal?: AbortSignal,
): Promise<Response> {
  if (
    !isUuid(attachmentId) ||
    !verifyPrivateDownloadToken(token, attachmentId, userId, {
      secret: attachmentSecret(deps.downloadSecret),
      now: deps.now,
    })
  ) {
    return emptyAttachmentResponse(404);
  }
  let record: DownloadRecord | null;
  try {
    record = await findDownloadable(deps, userId, attachmentId);
  } catch (error) {
    return emptyAttachmentResponse(repositoryError(error, 'attachments.download') === 'INTERNAL' ? 503 : 404);
  }
  if (!record) return emptyAttachmentResponse(404);

  const opened = await deps.store.openStream({ key: record.key, signal });
  if (!opened.ok) {
    captureError(new AppError('INTERNAL'), { area: 'attachments.download.open' });
    return emptyAttachmentResponse(opened.error === 'NOT_FOUND' ? 404 : 503);
  }
  const { body, contentLength, contentType, close } = opened.value;
  if (contentLength !== record.sizeBytes || contentType !== record.mimeType) {
    await close();
    captureError(new AppError('INTERNAL'), { area: 'attachments.download.mismatch' });
    return emptyAttachmentResponse(503);
  }
  return new Response(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      'content-type': record.mimeType,
      'content-length': String(contentLength),
      // Zawsze jako plik do zapisania (także zdjęcia) — przeglądarka nie renderuje treści.
      'content-disposition': attachmentDisposition(record.fileName),
      'content-security-policy': "default-src 'none'; sandbox",
    },
  });
}
