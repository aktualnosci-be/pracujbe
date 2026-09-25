'use server';

import { z } from 'zod/v3';

import { getPortalIdentity } from '@/lib/db/portal';
import { isProductionMode } from '@/lib/env';
import { AppError, type ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { checkAttachmentFile, type AttachmentFileProblem } from '@/lib/validation/message-attachment';

/**
 * Załączniki wiadomości (0119) — granica Server Actions. Autor = użytkownik potwierdzonej
 * sesji serwera; klient podaje wyłącznie rozmowę, klucz operacji uploadu i plik albo ID
 * załącznika. Logika w `src/lib/files/message-attachments.ts`, dostęp rozstrzyga baza.
 *
 * Bez konfiguracji bucketu/bazy: poza produkcją `DEMO_UNAVAILABLE` (bez fikcyjnego sukcesu),
 * w trybie produkcyjnym `INTERNAL` (fail-closed).
 */

export type AttachmentUploadActionResult =
  | { ok: true; id: string }
  | { ok: false; error: ErrorCode; reason?: AttachmentFileProblem };
export type AttachmentLinkActionResult = { ok: true; url: string } | { ok: false; error: ErrorCode };
export type AttachmentDiscardActionResult = { ok: true } | { ok: false; error: ErrorCode };

const uuid = z.string().uuid();

type Context =
  | { ok: true; deps: import('@/lib/files/message-attachments').AttachmentServiceDeps; userId: string }
  | { ok: false; error: ErrorCode };

async function sessionContext(): Promise<Context> {
  const { getAttachmentServiceDeps } = await import('@/lib/files/runtime');
  const deps = await getAttachmentServiceDeps();
  if (!deps) return { ok: false, error: isProductionMode() ? 'INTERNAL' : 'DEMO_UNAVAILABLE' };
  const me = await getPortalIdentity();
  if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
  return { ok: true, deps, userId: me.id };
}

function unexpected(area: string): { ok: false; error: 'INTERNAL' } {
  captureError(new AppError('INTERNAL'), { area });
  return { ok: false, error: 'INTERNAL' };
}

/**
 * Upload jednego pliku do rozmowy (PDF/DOC/DOCX/JPG/PNG, ≤ 5 MB). `clientUploadId` = stały
 * UUID tej operacji: ponowienie po utracie odpowiedzi zwraca ten sam załącznik.
 */
export async function uploadMessageAttachment(formData: FormData): Promise<AttachmentUploadActionResult> {
  const conversationId = formData.get('conversationId');
  const clientUploadId = formData.get('clientUploadId');
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'VALIDATION_FAILED', reason: 'empty' };
  const problem = checkAttachmentFile(file);
  if (problem) return { ok: false, error: 'VALIDATION_FAILED', reason: problem };
  if (!(await checkRateLimit('message-attachment', { max: 30, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  try {
    // Tryb demo (rozmowy bez UUID) dostaje jawny komunikat demo przed walidacją identyfikatorów.
    const context = await sessionContext();
    if (!context.ok) return context;
    if (!uuid.safeParse(conversationId).success || !uuid.safeParse(clientUploadId).success) {
      return { ok: false, error: 'VALIDATION_FAILED' };
    }
    const { storeMessageAttachment } = await import('@/lib/files/message-attachments');
    return await storeMessageAttachment(
      context.deps,
      context.userId,
      conversationId as string,
      clientUploadId as string,
      file,
    );
  } catch {
    return unexpected('attachments.upload');
  }
}

/** Usuwa własny, jeszcze niewysłany załącznik (przycisk „Usuń” w polu wiadomości). */
export async function discardMessageAttachment(attachmentId: string): Promise<AttachmentDiscardActionResult> {
  if (!uuid.safeParse(attachmentId).success) return { ok: false, error: 'NOT_FOUND' };
  try {
    const context = await sessionContext();
    if (!context.ok) return context;
    const { discardStagedAttachment } = await import('@/lib/files/message-attachments');
    return await discardStagedAttachment(context.deps, context.userId, attachmentId);
  } catch {
    return unexpected('attachments.discard');
  }
}

/** Krótki podpisany link do pobrania załącznika z rozmowy (klik w nazwę pliku). */
export async function prepareMessageAttachmentDownload(attachmentId: string): Promise<AttachmentLinkActionResult> {
  if (!uuid.safeParse(attachmentId).success) return { ok: false, error: 'NOT_FOUND' };
  try {
    const context = await sessionContext();
    if (!context.ok) return context;
    const { issueAttachmentDownloadLink } = await import('@/lib/files/message-attachments');
    return await issueAttachmentDownloadLink(context.deps, context.userId, attachmentId);
  } catch {
    return unexpected('attachments.link');
  }
}
