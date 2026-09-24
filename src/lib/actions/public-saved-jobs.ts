'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v3';
import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';

export type PublicSavedState =
  | { status: 'candidate'; savedIds: string[] }
  | { status: 'anonymous' | 'unavailable' | 'error' };

/**
 * Serwer fixture E2E (tryb `full`, bez bazy): cookie `pb_e2e_viewer=anonymous` udaje gościa,
 * żeby E2E sprawdziło aplikację bez konta (#98). Nie działa w buildzie produkcyjnym.
 */
async function isAnonymousViewerFixture(): Promise<boolean> {
  if (process.env.NODE_ENV !== 'development' || process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE !== 'full') {
    return false;
  }
  return (await cookies()).get('pb_e2e_viewer')?.value === 'anonymous';
}

/** Jeden odczyt partii pod RLS, bez wspólnego cache. */
export async function getPublicSavedJobs(
  jobIds: string[],
): Promise<PublicSavedState> {
  const parsed = z.array(z.string().uuid()).max(100).safeParse(jobIds);
  if (await isAnonymousViewerFixture()) return { status: 'anonymous' };
  if (!parsed.success) return { status: 'unavailable' };
  if (!isSupabaseConfigured()) return { status: 'unavailable' };
  try {
    const client = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await client.auth.getUser();
    if (!user) {
      if (authError && authError.name !== 'AuthSessionMissingError')
        return { status: 'error' };
      return { status: 'anonymous' };
    }
    if (authError) return { status: 'error' };
    const { data: profile, error: profileError } = await client
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .single();
    if (profileError) return { status: 'error' };
    if (profile?.role !== 'candidate') return { status: 'unavailable' };
    const ids = [...new Set(parsed.data)];
    if (!ids.length) return { status: 'candidate', savedIds: [] };
    const { data, error } = await client
      .from('saved_jobs')
      .select('job_id')
      .eq('candidate_id', user.id)
      .in('job_id', ids)
      .limit(100);
    if (error || !data) return { status: 'error' };
    return {
      status: 'candidate',
      savedIds: data.map((row) => row.job_id as string),
    };
  } catch {
    return { status: 'error' };
  }
}
