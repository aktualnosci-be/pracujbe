'use server';

import { z } from 'zod';

import { routing } from '@/i18n/routing';
import { getMyOffersPage, type MyOffersPage } from '@/lib/data/candidate';
import type { ErrorCode } from '@/lib/errors';
import { isRecruitmentEnabled } from '@/lib/portal-mode';

const cursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type MoreProposalsResult =
  | { status: 'ready'; page: MyOffersPage }
  | { status: 'error'; error?: Extract<ErrorCode, 'RECRUITMENT_DISABLED'> };

/** Serwer czyta każdą kolejną stronę propozycji ponownie pod bieżącą sesją i RLS. */
export async function loadMoreProposals(locale: string, cursor: unknown): Promise<MoreProposalsResult> {
  // #1141: portal ogłoszeniowy — bez odczytu bazy.
  if (!isRecruitmentEnabled('offers')) return { status: 'error', error: 'RECRUITMENT_DISABLED' };
  if (!routing.locales.some((available) => available === locale)) return { status: 'error' };
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success) return { status: 'error' };

  try {
    return { status: 'ready', page: await getMyOffersPage(locale, parsed.data) };
  } catch {
    return { status: 'error' };
  }
}
