'use server';

import { randomUUID } from 'node:crypto';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { removeFile, CANDIDATE_BUCKET } from '@/lib/storage';
import type { ErrorCode } from '@/lib/errors';
import { CV_ALLOWED_TYPES, checkCvFile, type CvFileProblem } from '@/lib/validation/cv-file';

/**
 * Upload/usuwanie plików kandydata (CV) — Invariant #10 (prywatny bucket + signed URLs).
 * Zapis idzie pod sesją usera (RLS storage: własny folder `<uid>/...`). Metadane w tabeli files.
 * Bez env: tryb demo (no-op sukces), żeby UI działało bez konfiguracji.
 */

/** `reason` rozróżnia błędy walidacji pliku (rozmiar / format), by UI podało konkretny komunikat. */
export type UploadResult =
  | { ok: true; id: string; path: string }
  | { ok: false; error: ErrorCode; reason?: CvFileProblem };
export type SimpleResult = { ok: true } | { ok: false; error: ErrorCode };


/**
 * Sygnatury (magic bytes) na typ. Weryfikujemy zawartość, bo MIME z klienta jest
 * niezaufany. DOCX to kontener ZIP (`PK`), stary DOC to OLE (`D0 CF 11 E0`).
 */
const SIGNATURES: Record<string, readonly number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  docx: [[0x50, 0x4b]], // PK (zip)
  doc: [[0xd0, 0xcf, 0x11, 0xe0]], // OLE compound file
};

/** Sprawdza, czy początek pliku pasuje do którejkolwiek sygnatury danego rozszerzenia. */
async function hasValidSignature(file: File, ext: string): Promise<boolean> {
  const sigs = SIGNATURES[ext];
  if (!sigs) return false;
  const maxLen = Math.max(...sigs.map((s) => s.length));
  const header = new Uint8Array(await file.slice(0, maxLen).arrayBuffer());
  return sigs.some(
    (sig) => sig.length <= header.length && sig.every((byte, i) => header[i] === byte),
  );
}

/**
 * Głębsza weryfikacja DOCX (P1-22): samo `PK` (ZIP) to za mało — dowolne archiwum przeszłoby
 * jako DOCX. Sprawdzamy, że kontener OOXML zawiera `[Content_Types].xml` oraz katalog `word/`.
 * Nazwy wpisów są w nagłówkach lokalnych ZIP jako tekst — skan bufora (latin1) je wykrywa.
 * (AV/CDR = follow-up: skan treści przez usługę zewnętrzną.)
 */
async function isOoxmlDocx(file: File): Promise<boolean> {
  const bytes = Buffer.from(await file.arrayBuffer()).toString('latin1');
  return bytes.includes('[Content_Types].xml') && bytes.includes('word/');
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
  const ext = CV_ALLOWED_TYPES.get(file.type)!;

  // Weryfikacja sygnatury zawartości (magic bytes) — MIME z klienta jest niezaufany.
  if (!(await hasValidSignature(file, ext))) {
    return { ok: false, error: 'VALIDATION_FAILED', reason: 'type' };
  }
  // P1-22: DOCX musi być realnym kontenerem OOXML (nie dowolnym ZIP-em).
  if (ext === 'docx' && !(await isOoxmlDocx(file))) {
    return { ok: false, error: 'VALIDATION_FAILED', reason: 'type' };
  }

  if (!isSupabaseConfigured()) return { ok: true, id: 'demo', path: 'demo/cv.pdf' };

  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

  const path = `${user.id}/cv-${randomUUID()}.${ext}`;
  const { error: upErr } = await supabase.storage
    .from(CANDIDATE_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { ok: false, error: 'INTERNAL' };

  // Metadane pliku (RLS: files_insert_own — owner_id = auth.uid()).
  const { data, error } = await supabase
    .from('files')
    .insert({
      owner_id: user.id,
      bucket: CANDIDATE_BUCKET,
      path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type,
      size_bytes: file.size,
      visibility: 'private',
      entity_type: 'candidate_cv',
      // AV odłożone → 'skipped' (walidacja treści przeszła). Po wpięciu skanera: 'pending'→'clean'.
      scan_status: 'skipped',
    })
    .select('id')
    .single();

  if (error) {
    // Wycofaj plik ze storage, by nie zostawić sieroty bez metadanych.
    await removeFile(path);
    return { ok: false, error: 'INTERNAL' };
  }

  return { ok: true, id: String(data.id), path };
}

/** Usuwa plik kandydata (storage + metadane) — RLS pilnuje własności. */
export async function deleteCandidateFile(fileId: string): Promise<SimpleResult> {
  if (!isSupabaseConfigured()) return { ok: true };
  const supabase = await createServerClient();

  const { data: row, error: selErr } = await supabase
    .from('files')
    .select('path, bucket')
    .eq('id', fileId)
    .single();
  if (selErr || !row) return { ok: false, error: 'NOT_FOUND' };

  // P1-22: usuń NAJPIERW metadane (pod RLS — potwierdza własność), potem obiekt Storage.
  // Odwrotna kolejność mogła zostawić rekord wskazujący na nieistniejący obiekt (gdy DB delete
  // padnie po udanym Storage remove). Osierocony obiekt (gdy Storage padnie) jest mniej szkodliwy
  // i usuwalny GC — logujemy wynik removeFile zamiast go ignorować.
  const { error } = await supabase.from('files').delete().eq('id', fileId);
  if (error) return { ok: false, error: 'PERMISSION_DENIED' };
  const removed = await removeFile(String(row.path), String(row.bucket));
  if (!removed) {
    const { captureError } = await import('@/lib/sentry');
    captureError(new Error('storage remove failed after db delete'), {
      area: 'files.deleteCandidateFile',
      fileId,
    });
  }
  return { ok: true };
}
