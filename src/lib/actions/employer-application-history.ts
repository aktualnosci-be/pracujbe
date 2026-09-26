'use server';

import { z } from 'zod';

import { getEmployerApplicationHistoryPage, type ApplicationHistoryPage } from '@/lib/data/employer';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type MoreApplicationHistoryResult =
  | { status: 'ready'; page: ApplicationHistoryPage }
  | { status: 'error' };

/**
 * Kolejna strona historii statusów zgłoszenia w panelu pracodawcy (#604, „Pokaż więcej").
 * Serwer czyta pod bieżącą sesją i RLS, ponownie zawężony do aktywnej firmy — `applicationId`
 * z klienta jest niezaufany.
 */
export async function loadMoreApplicationHistory(
  applicationId: string,
  cursor: unknown,
): Promise<MoreApplicationHistoryResult> {
  if (!UUID_RE.test(applicationId)) return { status: 'error' };
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success) return { status: 'error' };

  try {
    return { status: 'ready', page: await getEmployerApplicationHistoryPage(applicationId, parsed.data) };
  } catch {
    return { status: 'error' };
  }
}
