/**
 * Dokumenty kandydata (CV) z jawnym wynikiem odczytu (#331).
 *
 * Błąd odczytu listy NIE jest pustą listą: kandydat uznałby, że CV zniknęło, i wgrał je ponownie
 * (duplikaty w `files` i Storage). Loader zwraca `ready` z pozycjami albo `error`. Błąd podpisania
 * pojedynczego URL-a daje pozycję bez linku (`url: null`), a nie błąd całej listy.
 * Odczyt pod sesją kandydata (RLS), signed URLs z prywatnego bucketu (Invariant #10).
 */

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';

export interface CandidateFileItem {
  id: string;
  fileName: string;
  url: string | null;
}

export type CandidateFilesLoad =
  | { status: 'ready'; items: CandidateFileItem[] }
  | { status: 'error' };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export async function loadCandidateFiles(): Promise<CandidateFilesLoad> {
  if (!isSupabaseConfigured()) return { status: 'ready', items: [] };
  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const { getSignedFileUrl } = await import('@/lib/storage');
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { status: 'error' };

    const { data, error } = await supabase
      .from('files')
      .select('id, path, bucket, file_name')
      .eq('owner_id', user.id)
      .eq('entity_type', 'candidate_cv')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;

    const rows = Array.isArray(data) ? data : [];
    const items = await Promise.all(
      rows.map(async (row): Promise<CandidateFileItem> => {
        const r = asRecord(row);
        const path = asStr(r['path']);
        const bucket = asStr(r['bucket']) || undefined;
        let url: string | null = null;
        if (path) {
          try {
            url = await getSignedFileUrl(path, bucket);
          } catch (urlError) {
            captureError(urlError, { area: 'candidate-files.signedUrl' });
          }
        }
        return {
          id: asStr(r['id']),
          fileName: asStr(r['file_name']) || path.split('/').pop() || 'CV',
          url,
        };
      }),
    );
    return { status: 'ready', items };
  } catch (error) {
    captureError(error, { area: 'candidate-files.loadCandidateFiles' });
    return { status: 'error' };
  }
}
