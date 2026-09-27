'use server';

import { z } from 'zod';

import { routing } from '@/i18n/routing';
import {
  getMyApplicationHistoryPage,
  getMyApplicationScreeningAnswers,
  getMyApplicationsPage,
  type MyApplicationHistoryPage,
  type MyApplicationsPage,
} from '@/lib/data/candidate';
import type { ScreeningAnswer } from '@/lib/screening/questions';
import { APPLICATION_FILTERS } from '@/lib/candidate-application-filter';

const cursorSchema = z.object({
  submittedAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type MoreApplicationsResult =
  | { status: 'ready'; page: MyApplicationsPage }
  | { status: 'error' };

/** Filtr etapu z klienta (#809): brak = wszystkie; wartość spoza listy = błąd, nie „wszystkie”. */
const filterSchema = z.enum(APPLICATION_FILTERS).nullable().optional();

/** Serwer czyta każdą kolejną stronę ponownie pod bieżącą sesją i RLS (z tym samym filtrem etapu). */
export async function loadMoreApplications(
  locale: string,
  cursor: unknown,
  filter?: unknown,
): Promise<MoreApplicationsResult> {
  if (!routing.locales.some((available) => available === locale)) return { status: 'error' };
  const parsed = cursorSchema.safeParse(cursor);
  const parsedFilter = filterSchema.safeParse(filter);
  if (!parsed.success || !parsedFilter.success) return { status: 'error' };

  try {
    return { status: 'ready', page: await getMyApplicationsPage(locale, parsed.data, parsedFilter.data ?? null) };
  } catch {
    return { status: 'error' };
  }
}

export type ApplicationAnswersResult =
  | { status: 'ready'; answers: ScreeningAnswer[] }
  | { status: 'error' };

/** Identyfikator zgłoszenia: UUID z bazy albo zgłoszenie DEMO (`demo-app-N`, tylko bez bazy). */
const applicationIdSchema = z.union([z.uuid(), z.string().regex(/^demo-app-\d{1,2}$/)]);

/** #101: odpowiedzi na pytania własnego zgłoszenia — odczyt pod bieżącą sesją i RLS. */
export async function loadApplicationScreeningAnswers(applicationId: unknown): Promise<ApplicationAnswersResult> {
  const parsed = applicationIdSchema.safeParse(applicationId);
  if (!parsed.success) return { status: 'error' };

  try {
    return { status: 'ready', answers: await getMyApplicationScreeningAnswers(parsed.data) };
  } catch {
    return { status: 'error' };
  }
}

const historyCursorSchema = z.object({
  createdAt: z.iso.datetime({ offset: true }),
  id: z.uuid(),
});

export type MoreMyApplicationHistoryResult =
  | { status: 'ready'; page: MyApplicationHistoryPage }
  | { status: 'error' };

/**
 * Kolejna strona historii statusów własnego zgłoszenia („Pokaż więcej" w szczególe).
 * `applicationId` i kursor z klienta są niezaufane: walidacja Zod, potem odczyt pod bieżącą
 * sesją z ponownym sprawdzeniem własności zgłoszenia.
 */
export async function loadMoreMyApplicationHistory(
  applicationId: unknown,
  cursor: unknown,
): Promise<MoreMyApplicationHistoryResult> {
  const parsedId = z.uuid().safeParse(applicationId);
  const parsedCursor = historyCursorSchema.safeParse(cursor);
  if (!parsedId.success || !parsedCursor.success) return { status: 'error' };

  try {
    return { status: 'ready', page: await getMyApplicationHistoryPage(parsedId.data, parsedCursor.data) };
  } catch {
    return { status: 'error' };
  }
}
