import { isAppealStatus, parseAppealState, type AppealState, type AppealStatus } from '@/lib/admin/appeals';
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

/** Wynik rozstrzygniętej sprawy (#42) — bez uzasadnienia (zakres bezpieczny dla zgłaszającego). */
export const REPORT_OUTCOMES = ['action_taken', 'no_action'] as const;
export type ReportOutcome = (typeof REPORT_OUTCOMES)[number];

export interface ReportCaseView {
  caseNumber: string;
  status: ReportStatus;
  targetType: ReportTarget;
  category: ReportCategory;
  createdAt: string;
  dueAt: string | null;
  /** Wynik decyzji moderacyjnej albo null (sprawa w toku). */
  outcome: ReportOutcome | null;
  /** Droga odwołania od braku działań (#43); null = odwołanie nie dotyczy tej sprawy. */
  appealState: AppealState | null;
  /** Koniec terminu odwołania; null = termin jeszcze nie biegnie. */
  appealDeadline: string | null;
  /** Odwołanie zgłaszającego (bez danych autora treści). */
  appeal: ReportCaseAppeal | null;
  /** Ostatnie cofnięcie ograniczenia w sprawie i droga odwołania od niego (#43, 0109). */
  restoration: ReportCaseRestoration | null;
  events: ReportCaseEvent[];
}

export interface ReportCaseRestoration {
  restoredAt: string;
  /** `OK` — można się odwołać od cofnięcia; null = nieznany stan (nie pokazujemy formularza). */
  appealState: AppealState | null;
  /** Koniec terminu odwołania od cofnięcia; null = termin jeszcze nie biegnie. */
  appealDeadline: string | null;
  appeal: ReportCaseAppeal | null;
}

export interface ReportCaseAppeal {
  reference: string;
  status: AppealStatus;
  submittedAt: string;
  dueAt: string | null;
  decidedAt: string | null;
  reasoning: string | null;
}

function parseAppeal(raw: unknown): ReportCaseAppeal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (typeof a['reference'] !== 'string' || !isAppealStatus(a['status']) || typeof a['submittedAt'] !== 'string') {
    return null;
  }
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    reference: a['reference'],
    status: a['status'],
    submittedAt: a['submittedAt'],
    dueAt: str(a['dueAt']),
    decidedAt: str(a['decidedAt']),
    reasoning: str(a['reasoning']),
  };
}

function parseRestoration(raw: unknown): ReportCaseRestoration | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r['restoredAt'] !== 'string') return null;
  return {
    restoredAt: r['restoredAt'],
    appealState: parseAppealState(r['appealState']),
    appealDeadline: typeof r['appealDeadline'] === 'string' ? r['appealDeadline'] : null,
    appeal: parseAppeal(r['appeal']),
  };
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
    outcome: oneOf(REPORT_OUTCOMES, r['outcome']),
    appealState: parseAppealState(r['appealState']),
    appealDeadline: typeof r['appealDeadline'] === 'string' ? r['appealDeadline'] : null,
    appeal: parseAppeal(r['appeal']),
    restoration: parseRestoration(r['restoration']),
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
    outcome: null,
    appealState: null,
    appealDeadline: null,
    appeal: null,
    restoration: null,
    events: [
      { type: 'submitted', toStatus: 'open', at: '2026-09-20T10:00:00.000Z' },
      { type: 'status_changed', toStatus: 'reviewing', at: '2026-09-21T09:30:00.000Z' },
    ],
  };
}

/** Sprawa fixture rozstrzygnięta bez działań — z otwartą drogą odwołania (#43, E2E). */
export const FIXTURE_DISMISSED_CASE_NUMBER = 'DSA-0000-0000-0000-1E2E';

export function fixtureDismissedReportCase(): ReportCaseView {
  return {
    ...fixtureReportCase(),
    caseNumber: FIXTURE_DISMISSED_CASE_NUMBER,
    status: 'dismissed',
    outcome: 'no_action',
    appealState: 'OK',
    appealDeadline: '2027-03-22T10:00:00.000Z',
    events: [
      { type: 'submitted', toStatus: 'open', at: '2026-09-20T10:00:00.000Z' },
      { type: 'status_changed', toStatus: 'dismissed', at: '2026-09-22T10:00:00.000Z' },
    ],
  };
}

/** Sprawa fixture z cofniętym ograniczeniem — z otwartą drogą odwołania od cofnięcia (E2E). */
export const FIXTURE_RESTORED_CASE_NUMBER = 'DSA-0000-0000-0000-2E2E';

export function fixtureRestoredReportCase(): ReportCaseView {
  return {
    ...fixtureReportCase(),
    caseNumber: FIXTURE_RESTORED_CASE_NUMBER,
    status: 'resolved',
    outcome: 'action_taken',
    restoration: {
      restoredAt: '2026-09-23T10:00:00.000Z',
      appealState: 'OK',
      appealDeadline: '2027-03-23T10:00:00.000Z',
      appeal: null,
    },
    events: [
      { type: 'submitted', toStatus: 'open', at: '2026-09-20T10:00:00.000Z' },
      { type: 'status_changed', toStatus: 'resolved', at: '2026-09-22T10:00:00.000Z' },
    ],
  };
}
