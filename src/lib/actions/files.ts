'use server';

import { headers } from 'next/headers';

import { isProductionMode } from '@/lib/env';
import { AppError, type ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { checkCvFile, type CvFileProblem } from '@/lib/validation/cv-file';

/**
 * Upload / pobranie / usunięcie CV kandydata — prywatny bucket Railway (#26, Invariant #10).
 * Właściciel pliku = kandydat z potwierdzonej sesji serwera; klient podaje wyłącznie plik
 * albo ID rekordu. Logika w `src/lib/files/candidate-cv.ts`, tu tylko granica akcji.
 *
 * Bez konfiguracji bucketu: poza produkcją `DEMO_UNAVAILABLE` (bez fikcyjnego sukcesu),
 * w trybie produkcyjnym `INTERNAL` (fail-closed).
 */

/** `reason` rozróżnia błędy walidacji pliku (rozmiar / format), by UI podało konkretny komunikat. */
export type UploadResult =
  | { ok: true; id: string }
  | { ok: false; error: ErrorCode; reason?: CvFileProblem };
export type SimpleResult = { ok: true } | { ok: false; error: ErrorCode };
export type DownloadLinkResult = { ok: true; url: string } | { ok: false; error: ErrorCode };

type Session =
  | { ok: true; deps: import('@/lib/files/candidate-cv').CvServiceDeps; userId: string }
  | { ok: false; error: ErrorCode };

async function candidateContext(): Promise<Session> {
  const { getCvServiceDeps, readCandidateSession } = await import('@/lib/files/runtime');
  const deps = await getCvServiceDeps();
  if (!deps) return { ok: false, error: isProductionMode() ? 'INTERNAL' : 'DEMO_UNAVAILABLE' };
  const session = await readCandidateSession(deps.pool, new Headers(await headers()));
  if (session.status !== 'candidate') return { ok: false, error: 'PERMISSION_DENIED' };
  return { ok: true, deps, userId: session.id };
}

function unexpected(area: string): { ok: false; error: 'INTERNAL' } {
  captureError(new AppError('INTERNAL'), { area });
  return { ok: false, error: 'INTERNAL' };
}

/** Upload CV kandydata (PDF/DOC/DOCX, <=5MB). */
export async function uploadCandidateCv(formData: FormData): Promise<UploadResult> {
  if (!(await checkRateLimit('upload', { max: 20, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }
  const file = formData.get('file');
  if (!(file instanceof File)) return { ok: false, error: 'VALIDATION_FAILED', reason: 'empty' };
  const problem = checkCvFile(file);
  if (problem) return { ok: false, error: 'VALIDATION_FAILED', reason: problem };
  try {
    const context = await candidateContext();
    if (!context.ok) return context;
    const { storeCandidateCv } = await import('@/lib/files/candidate-cv');
    return await storeCandidateCv(context.deps, context.userId, file);
  } catch {
    return unexpected('files.uploadCandidateCv');
  }
}

/** Krótki podpisany link aplikacji do pobrania własnego CV (klik „Pobierz”). */
export async function prepareCvDownload(fileId: string): Promise<DownloadLinkResult> {
  try {
    const context = await candidateContext();
    if (!context.ok) return context;
    const { issueCvDownloadLink } = await import('@/lib/files/candidate-cv');
    return await issueCvDownloadLink(context.deps, context.userId, fileId);
  } catch {
    return unexpected('files.prepareCvDownload');
  }
}

/** Usuwa własne CV: rekord pod RLS, potem obiekt w buckecie. */
export async function deleteCandidateFile(fileId: string): Promise<SimpleResult> {
  try {
    const context = await candidateContext();
    if (!context.ok) return context;
    const { removeCandidateCv } = await import('@/lib/files/candidate-cv');
    return await removeCandidateCv(context.deps, context.userId, fileId);
  } catch {
    return unexpected('files.deleteCandidateFile');
  }
}
