'use server';

import { cookies } from 'next/headers';
import { z } from 'zod/v3';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';

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
  if (!isPortalDataConfigured()) return { status: 'unavailable' };
  try {
    // Tożsamość z sesji serwera (rola z profilu, już sprawdzona). Brak = gość.
    const me = await getPortalIdentity();
    if (!me) return { status: 'anonymous' };
    if (me.role !== 'candidate') return { status: 'unavailable' };
    const ids = [...new Set(parsed.data)];
    if (!ids.length) return { status: 'candidate', savedIds: [] };
    const rows = await withPortalTransaction(me, (tx) => queryRows<{ job_id: string }>(tx, 'candidate.public-saved-jobs',
      `SELECT job_id FROM public.saved_jobs
        WHERE candidate_id = $1 AND job_id = ANY($2::uuid[])
        LIMIT 100`, [me.id, ids]));
    return {
      status: 'candidate',
      savedIds: rows.map((row) => row.job_id),
    };
  } catch {
    return { status: 'error' };
  }
}
