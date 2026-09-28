'use server';

import { z } from 'zod';

import { getEmployerApplicationHistoryPage, type ApplicationHistoryPage } from '@/lib/data/employer';
import type { ErrorCode } from '@/lib/errors';
import { isRecruitmentEnabled } from '@/lib/portal-mode';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type MoreApplicationHistoryResult =
  | { status: 'ready'; page: ApplicationHistoryPage }
  | { status: 'error'; error?: Extract<ErrorCode, 'RECRUITMENT_DISABLED'> };

/**
 * Kolejna strona historii statusów zgłoszenia w panelu pracodawcy (#604, „Pokaż więcej").
 * Serwer czyta pod bieżącą sesją i RLS, ponownie zawężony do aktywnej firmy — `applicationId`
 * z klienta jest niezaufany.
 *
 * #770: loader zwraca jawny status (`ok`/`error`) — awaria zapytania NIE jest tu zamieniana
 * na pustą, gotową stronę. Inaczej UI usuwa kursor i „Pokaż więcej”, jakby historia się
 * skończyła, i pracodawca traci resztę historii bez komunikatu i bez możliwości ponowienia.
 */
export async function loadMoreApplicationHistory(
  applicationId: string,
  cursor: unknown,
): Promise<MoreApplicationHistoryResult> {
  // #1144: portal ogłoszeniowy — bez odczytu bazy.
  if (!isRecruitmentEnabled('applications')) return { status: 'error', error: 'RECRUITMENT_DISABLED' };
  if (!UUID_RE.test(applicationId)) return { status: 'error' };
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success) return { status: 'error' };

  try {
    const result = await getEmployerApplicationHistoryPage(applicationId, parsed.data);
    if (result.status === 'error') return { status: 'error' };
    return { status: 'ready', page: result.page };
  } catch {
    return { status: 'error' };
  }
}
