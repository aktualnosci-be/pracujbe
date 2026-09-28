import { beforeEach, describe, expect, it, vi } from 'vitest';

import { publishJob } from '@/lib/actions/jobs';
import { parseAuditAction, parseAuditEntity, visibleAuditActions, visibleAuditEntityTypes, isScreeningAuditRow } from '@/lib/admin/list-params';
import { getMyApplicationScreeningAnswers, getMyApplicationsPage } from '@/lib/data/candidate';
import { listAuditLogs, listScreeningReviews } from '@/lib/data/admin';
import { getNotifications, getNotificationsPage } from '@/lib/data/notifications';
import { getJobBySlug } from '@/lib/jobs';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
import { withClassifiedsMode, withRecruitmentMode } from '../helpers/portal-mode';

/**
 * Decyzja produktowa: portal ogłoszeniowy (#1128) — stare pytania screeningowe i ich przeglądy
 * (sprzed trybu) są ukryte wszędzie w warstwie aplikacji. W trybie CLASSIFIEDS_ONLY loadery nie
 * wołają zapytań o pytania/odpowiedzi/przeglądy; tryb RECRUITMENT (kontrola ujemna) bez zmian.
 * Dane w bazie zostają (bez migracji). Dowód na PG16: `tests/integration/portal-screening-banner.test.ts`.
 */

const adapters = vi.hoisted(() => ({
  detail: vi.fn(),
  translations: vi.fn(async () => [] as unknown[]),
  screening: vi.fn(async () => [] as unknown[]),
  costs: vi.fn(async () => null as Record<string, unknown> | null),
  pool: {},
}));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));
vi.mock('next-intl/server', () => ({ getTranslations: vi.fn(async () => (key: string) => key) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => adapters.pool }));
vi.mock('@/lib/db/public-jobs', () => ({
  getPublicJob: adapters.detail,
  getPublicJobTranslations: adapters.translations,
  getPublicJobScreeningQuestions: adapters.screening,
  getPublicJobCosts: adapters.costs,
}));

const ME = '11111111-1111-4111-8111-111111111111';
const APP = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const JOB = '5a0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';

const QUESTION = { id: 'q-1', position: 0, type: 'yes_no', required: true, prompt: { pl: 'C+E?' }, options: [] };

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: ME, role: 'candidate' });
});

function publicJobRow() {
  adapters.detail.mockResolvedValue({ id: 'job-1', slug: 'kierowca', title: 'Kierowca', published_at: '2026-01-01T00:00:00Z' });
  adapters.screening.mockResolvedValue([QUESTION]);
}

describe('szczegół publicznej oferty', () => {
  it('CLASSIFIEDS_ONLY: pytania nie są odczytywane i nie trafiają do oferty', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    vi.stubEnv('PORTAL_LEGAL_MODE', '');
    publicJobRow();
    const job = await getJobBySlug('kierowca', 'pl');
    expect(adapters.screening).not.toHaveBeenCalled();
    expect(job).not.toHaveProperty('screeningQuestions');
    vi.unstubAllEnvs();
  });

  it('kontrola ujemna, RECRUITMENT: pytania są odczytywane', async () => {
    vi.stubEnv('DATABASE_APP_URL', 'postgres://test-placeholder');
    vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');
    publicJobRow();
    const job = await getJobBySlug('kierowca', 'pl');
    expect(adapters.screening).toHaveBeenCalledTimes(1);
    expect(job?.screeningQuestions).toHaveLength(1);
    vi.unstubAllEnvs();
  });
});

describe('publishJob — błąd przeglądu pytań z bazy', () => {
  function mockPublish(message: string) {
    resetFakeDb({ id: ME, role: 'employer' });
    fakeDb
      .rows('jobs.publish-title', [{ id: JOB, title: 'Magazynier' }])
      .rpc('publish_job', () => { throw pgError('P0001', message); })
      .rows('jobs.screening-questions-review', [{ position: 1, content_fingerprint: 'b', risk_categories: ['age'] }])
      .rows('jobs.screening-reviews', [{ content_fingerprint: 'b', status: 'pending' }]);
  }

  describe('CLASSIFIEDS_ONLY', () => {
    withClassifiedsMode();
    it.each(['SCREENING_REVIEW_REQUIRED: 1', 'SCREENING_QUESTION_REJECTED: 1'])(
      '%s → ogólny błąd bez stanu pytań i bez odczytu przeglądów',
      async (message) => {
        mockPublish(message);
        const res = await publishJob(JOB);
        expect(res).toEqual({ ok: false, error: 'INTERNAL' });
        expect(fakeDb.callsTo('jobs.screening-questions-review')).toHaveLength(0);
        expect(fakeDb.callsTo('jobs.screening-reviews')).toHaveLength(0);
      },
    );
  });

  describe('kontrola ujemna: RECRUITMENT', () => {
    withRecruitmentMode();
    it('kod i stan pytań do poprawy są zwracane', async () => {
      mockPublish('SCREENING_REVIEW_REQUIRED: 1');
      const res = await publishJob(JOB);
      expect(res).toMatchObject({ ok: false, error: 'SCREENING_REVIEW_REQUIRED', screening: [{ index: 1 }] });
      expect(fakeDb.callsTo('jobs.screening-reviews')).toHaveLength(1);
    });
  });
});

describe('powiadomienia o przeglądzie pytań', () => {
  const rowsFor = () => [{ id: 'n1', type: 'system', entity_type: 'job', entity_id: JOB, data: { kind: 'screening_review', status: 'hidden' }, read_at: null, created_at: '2026-09-23T00:00:00Z' }];
  function register() {
    fakeDb.rows('notifications.latest', rowsFor).rows('notifications.page', rowsFor).count('notifications.unread', 1);
  }

  describe('CLASSIFIEDS_ONLY', () => {
    withClassifiedsMode();
    it('lista, pełna lista i licznik zawężają zapytania do powiadomień innych niż przegląd pytań', async () => {
      register();
      await getNotifications('pl');
      await getNotificationsPage('pl');
      for (const name of ['notifications.latest', 'notifications.unread', 'notifications.page']) {
        const [call] = fakeDb.callsTo(name);
        expect(call?.text).toContain("data->>'kind' IS DISTINCT FROM 'screening_review'");
        expect(call?.values).toContain(false);
      }
      expect(fakeDb.callsTo('notifications.unread').map((call) => call.values)).toEqual([[ME, false], [ME, false]]);
    });
  });

  describe('kontrola ujemna: RECRUITMENT', () => {
    withRecruitmentMode();
    it('zapytania przepuszczają powiadomienia o przeglądzie pytań', async () => {
      register();
      await getNotifications('pl');
      expect(fakeDb.callsTo('notifications.latest')[0]?.values).toEqual([ME, true]);
      expect(fakeDb.callsTo('notifications.unread')[0]?.values).toEqual([ME, true]);
    });
  });
});

describe('zgłoszenia kandydata', () => {
  describe('CLASSIFIEDS_ONLY', () => {
    withClassifiedsMode();
    it('odpowiedzi nie są odczytywane, licznik na liście = stałe 0 bez podzapytania', async () => {
      expect(await getMyApplicationScreeningAnswers(APP)).toEqual([]);
      expect(fakeDb.calls).toHaveLength(0);

      fakeDb.rows('candidate.applications-page', [{ id: APP, job_id: JOB, status: 'submitted', submitted_at: '2026-09-20T00:00:00Z', screening_count: 0 }]);
      fakeDb.rows('candidate.applied-jobs-page', []);
      await getMyApplicationsPage('pl').catch(() => undefined);
      const [call] = fakeDb.callsTo('candidate.applications-page');
      expect(call?.text).not.toContain('application_screening_answers');
      expect(call?.text).toContain('0 AS screening_count');
    });
  });

  describe('kontrola ujemna: RECRUITMENT', () => {
    withRecruitmentMode();
    it('odpowiedzi są odczytywane, licznik z podzapytaniem', async () => {
      fakeDb.rows('candidate.application-screening-answers', []);
      await getMyApplicationScreeningAnswers(APP);
      expect(fakeDb.callsTo('candidate.application-screening-answers')).toHaveLength(1);

      fakeDb.rows('candidate.applications-page', []);
      await getMyApplicationsPage('pl').catch(() => undefined);
      expect(fakeDb.callsTo('candidate.applications-page')[0]?.text).toContain('application_screening_answers');
    });
  });
});

describe('panel admina', () => {
  beforeEach(() => resetFakeDb({ id: ME, role: 'admin' }));

  describe('CLASSIFIEDS_ONLY', () => {
    withClassifiedsMode();

    it('kolejka przeglądu pytań: pusta, bez zapytań', async () => {
      expect(await listScreeningReviews({ status: 'all' })).toEqual({ status: 'ok', rows: [], nextCursor: null });
      expect(fakeDb.calls).toHaveLength(0);
    });

    it('dziennik: zapytanie pomija wpisy o pytaniach, filtr o pytaniach jest ignorowany', async () => {
      fakeDb.rows('admin.audit-logs', []).rows('admin.audit-actors', []).rows('admin.audit-companies', []);
      await listAuditLogs({ entity: 'screening_question_review', action: 'screening_question.hidden' });
      const [call] = fakeDb.callsTo('admin.audit-logs');
      expect(call?.text).toContain("entity_type IS DISTINCT FROM 'screening_question_review'");
      expect(call?.text).toContain("action NOT LIKE 'screening\\_question.%'");
      // Wartości filtrów spoza widocznej listy odpadają (jak nieznane), zostaje tylko limit.
      expect(call?.values).toEqual([51]);
    });

    it('filtry dziennika nie oferują przeglądu pytań', () => {
      expect(visibleAuditEntityTypes(false)).not.toContain('screening_question_review');
      expect(visibleAuditActions(false).map(([action]) => action).filter((action) => action.startsWith('screening_question.'))).toEqual([]);
      expect(parseAuditEntity('screening_question_review', false)).toBeNull();
      expect(parseAuditAction('screening_question.reviewed', false)).toBeNull();
      expect(parseAuditEntity('company', false)).toBe('company');
    });
  });

  describe('kontrola ujemna: RECRUITMENT', () => {
    withRecruitmentMode();

    it('dziennik bez ukrywania wpisów o pytaniach', async () => {
      fakeDb.rows('admin.audit-logs', []).rows('admin.audit-actors', []).rows('admin.audit-companies', []);
      await listAuditLogs({ entity: 'screening_question_review', action: 'screening_question.hidden' });
      const [call] = fakeDb.callsTo('admin.audit-logs');
      expect(call?.text).not.toContain('IS DISTINCT FROM');
      expect(call?.values).toEqual(['screening_question_review', 'screening_question.hidden', 51]);
    });

    it('filtry oferują przegląd pytań (domyślnie także bez argumentu)', () => {
      expect(visibleAuditEntityTypes(true)).toContain('screening_question_review');
      expect(parseAuditEntity('screening_question_review')).toBe('screening_question_review');
      expect(parseAuditAction('screening_question.reviewed')).toBe('screening_question.reviewed');
      expect(isScreeningAuditRow('screening_question_review', null)).toBe(true);
      expect(isScreeningAuditRow('job', 'screening_question.hidden')).toBe(true);
      expect(isScreeningAuditRow('job', 'job.duplicated')).toBe(false);
    });
  });
});
