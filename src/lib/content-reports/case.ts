import { REPORT_CATEGORIES, REPORT_TARGETS, type ReportCategory, type ReportTarget } from '@/lib/validation/content-report';

/**
 * Widok sprawy zgłoszenia dla zgłaszającego (#41) — parsowanie odpowiedzi `get_report_case`
 * (0094). Czysta funkcja: nieznane wartości odrzucamy zamiast pokazywać surowe kody.
 */

export const REPORT_STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export interface ReportCaseEvent {
  type: 'submitted' | 'status_changed';
  toStatus: ReportStatus | null;
  at: string;
}

export interface ReportCaseView {
  caseNumber: string;
  status: ReportStatus;
  targetType: ReportTarget;
  category: ReportCategory;
  createdAt: string;
  dueAt: string | null;
  events: ReportCaseEvent[];
}

function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return typeof value === 'string' && (list as readonly string[]).includes(value) ? (value as T) : null;
}

export function parseReportCase(data: unknown): ReportCaseView | null {
  if (typeof data !== 'object' || data === null) return null;
  const r = data as Record<string, unknown>;
  const status = oneOf(REPORT_STATUSES, r['status']);
  const targetType = oneOf(REPORT_TARGETS, r['targetType']);
  const category = oneOf(REPORT_CATEGORIES, r['category']);
  if (typeof r['caseNumber'] !== 'string' || !status || !targetType || !category) return null;
  if (typeof r['createdAt'] !== 'string') return null;
  const events = Array.isArray(r['events'])
    ? r['events'].flatMap((raw): ReportCaseEvent[] => {
        if (typeof raw !== 'object' || raw === null) return [];
        const e = raw as Record<string, unknown>;
        const type = e['type'] === 'submitted' || e['type'] === 'status_changed' ? e['type'] : null;
        if (!type || typeof e['at'] !== 'string') return [];
        return [{ type, toStatus: oneOf(REPORT_STATUSES, e['toStatus']), at: e['at'] }];
      })
    : [];
  return {
    caseNumber: r['caseNumber'],
    status,
    targetType,
    category,
    createdAt: r['createdAt'],
    dueAt: typeof r['dueAt'] === 'string' ? r['dueAt'] : null,
    events,
  };
}

/**
 * Serwer fixture E2E (`playwright.applications-fixture.config.ts`, tryb `full`): formularz
 * i sprawdzenie sprawy działają bez bazy. Nigdy w buildzie produkcyjnym (NODE_ENV).
 */
export function isReportFixtureMode(): boolean {
  return process.env.NODE_ENV === 'development' && process.env.PLAYWRIGHT_APPLICATIONS_FIXTURE === 'full';
}

export const FIXTURE_CASE_NUMBER = 'DSA-0000-0000-0000-0E2E';

export function fixtureReportCase(): ReportCaseView {
  return {
    caseNumber: FIXTURE_CASE_NUMBER,
    status: 'reviewing',
    targetType: 'job',
    category: 'fraud',
    createdAt: '2026-09-20T10:00:00.000Z',
    dueAt: '2026-09-27T10:00:00.000Z',
    events: [
      { type: 'submitted', toStatus: 'open', at: '2026-09-20T10:00:00.000Z' },
      { type: 'status_changed', toStatus: 'reviewing', at: '2026-09-21T09:30:00.000Z' },
    ],
  };
}
