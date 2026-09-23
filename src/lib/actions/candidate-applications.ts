'use server';

import { z } from 'zod';

import { routing } from '@/i18n/routing';
import { getMyApplicationsPage, type MyApplicationsPage } from '@/lib/data/candidate';

const cursorSchema = z.object({
  submittedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type MoreApplicationsResult =
  | { status: 'ready'; page: MyApplicationsPage }
  | { status: 'error' };

/** Serwer czyta każdą kolejną stronę ponownie pod bieżącą sesją i RLS. */
export async function loadMoreApplications(locale: string, cursor: unknown): Promise<MoreApplicationsResult> {
  if (!routing.locales.some((available) => available === locale)) return { status: 'error' };
  const parsed = cursorSchema.safeParse(cursor);
  if (!parsed.success) return { status: 'error' };

  try {
    return { status: 'ready', page: await getMyApplicationsPage(locale, parsed.data) };
  } catch {
    return { status: 'error' };
  }
}
