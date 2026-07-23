'use server';

import { randomUUID } from 'node:crypto';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import { checkRateLimit } from '@/lib/rate-limit';
import { removeFile, CANDIDATE_BUCKET } from '@/lib/storage';
import type { ErrorCode } from '@/lib/errors';

/**
 * Upload/usuwanie plików kandydata (CV) — Invariant #10 (prywatny bucket + signed URLs).
 * Zapis idzie pod sesją usera (RLS storage: własny folder `<uid>/...`). Metadane w tabeli files.
 * Bez env: tryb demo (no-op sukces), żeby UI działało bez konfiguracji.
 */

export type UploadResult =
  | { ok: true; id: string; path: string }
  | { ok: false; error: ErrorCode };
export type SimpleResult = { ok: true } | { ok: false; error: ErrorCode };

const MAX_BYTES = 5 * 1024 * 1024; // 5 MB
const ALLOWED = new Map<string, string>([
  ['application/pdf', 'pdf'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
]);

/** Upload CV kandydata (PDF/DOC/DOCX, <=5MB). */
export async function uploadCandidateCv(formData: FormData): Promise<UploadResult> {
  if (!(await checkRateLimit('upload', { max: 20, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'VALIDATION_FAILED' };
  if (file.size > MAX_BYTES) return { ok: false, error: 'VALIDATION_FAILED' };
  const ext = ALLOWED.get(file.type);
  if (!ext) return { ok: false, error: 'VALIDATION_FAILED' };

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

  await removeFile(String(row.path), String(row.bucket));
  const { error } = await supabase.from('files').delete().eq('id', fileId);
  if (error) return { ok: false, error: 'PERMISSION_DENIED' };
  return { ok: true };
}
