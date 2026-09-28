import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { withClassifiedsMode } from '../helpers/portal-mode';

/**
 * Tryb ogłoszeniowy (#1131, #1133, #1139; epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Portal nie liczy, nie zapisuje i nie pokazuje dopasowania kandydat ↔ oferta: maintenance nie
 * przelicza `matches`, akcja dopasowania nie otwiera transakcji, loadery pracodawcy (top
 * dopasowani, lista/szczegół kandydata, liczniki dopasowań) i polecane oferty kandydata nie
 * wysyłają zapytań. Każdy przypadek ma kontrolę ujemną: po wyłączeniu bramki (tryb
 * `RECRUITMENT`) ta sama ścieżka woła bazę — test bez bramki byłby czerwony.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/portal', async () => {
  const fake = (await import('../helpers/fake-db')).fakePortal();
  return {
    ...fake,
    getPortalIdentity: vi.fn(fake.getPortalIdentity),
    withPortalTransaction: vi.fn(fake.withPortalTransaction),
    withServiceRole: vi.fn(fake.withServiceRole),
  };
});
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: vi.fn(() => true),
  fileBucketConfig: () => null,
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));

const portal = await import('@/lib/db/portal');
const { getActiveCompany } = await import('@/lib/company-context');
const { POST } = await import('@/app/api/maintenance/route');
const { runMatchRecompute } = await import('@/lib/matching/materialize');
const { getMyJobMatchAction } = await import('@/lib/actions/matching');
const { getMyJobMatch } = await import('@/lib/data/matching');
const employer = await import('@/lib/data/employer');
const { getRecommendedJobs } = await import('@/lib/data/candidate');
const { resolveHref } = await import('@/lib/data/notifications');

const USER = '11111111-1111-4111-8111-111111111111';
const CANDIDATE = '22222222-2222-4222-8222-222222222222';

const MAINTENANCE_RPCS = [
  'release_stale_discount_reservations',
  'release_stale_checkout_intents',
  'ai_budget_release_stale_reservations',
  'expire_due_jobs',
  'match_recompute_claim',
  'purge_guest_application_requests',
  'process_saved_search_alerts',
  'process_email_campaigns',
  'run_retention_purge',
  'purge_job_funnel_data',
  'purge_stale_message_attachments',
  'rate_limit_gc',
  'processed_webhooks_gc',
  'claim_storage_deletions',
];

const maintenanceRequest = () =>
  new Request('http://web.internal/api/maintenance', {
    method: 'POST',
    headers: { authorization: 'Bearer maintenance-secret' },
  });

/** Tryb rekrutacyjny tylko dla kontroli ujemnej (jawnie w teście). */
const recruitment = () => vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');

withClassifiedsMode();

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
  process.env.MAINTENANCE_SECRET = 'maintenance-secret';
});
afterEach(() => {
  delete process.env.MAINTENANCE_SECRET;
});

describe('#1131: maintenance nie przelicza dopasowań', () => {
  beforeEach(() => {
    for (const fn of MAINTENANCE_RPCS) fakeDb.rpc(fn, fn === 'match_recompute_claim' ? [] : 0);
    // #1143: w trybie RECRUITMENT (env) maintenance pyta też bazę — dwuklucz.
    fakeDb.rpc('recruitment_enabled', true);
  });

  it('tryb ogłoszeniowy: zero zapytań match_recompute_*, odpowiedź matches: disabled', async () => {
    const res = await POST(maintenanceRequest());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, matches: 'disabled' });
    expect(fakeDb.calls.filter((c) => c.name.startsWith('match_recompute_'))).toEqual([]);
    expect(fakeDb.calls.filter((c) => c.name.startsWith('matching.'))).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT woła match_recompute_claim', async () => {
    recruitment();
    const res = await POST(maintenanceRequest());
    expect(res.status).toBe(200);
    expect(fakeDb.callsTo('match_recompute_claim')).toHaveLength(1);
    expect((await res.json()).matches).toEqual({ subjects: 0, failed: 0, upserted: 0, deleted: 0, skipped: 0 });
  });

  it('runMatchRecompute sam sprawdza tryb (druga linia obrony): bez połączenia z bazą', async () => {
    await expect(runMatchRecompute()).resolves.toEqual({ subjects: 0, failed: 0, upserted: 0, deleted: 0, skipped: 0 });
    expect(portal.withServiceRole).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: runMatchRecompute w trybie RECRUITMENT pobiera kolejkę', async () => {
    recruitment();
    await runMatchRecompute();
    expect(fakeDb.callsTo('match_recompute_claim')).toHaveLength(1);
  });
});

describe('#1131: kandydat nie dostaje procentu dopasowania', () => {
  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'candidate' });
    fakeDb.rows('matching.candidate-profile', []);
  });

  it('getMyJobMatchAction → disabled bez sesji, transakcji i zapytań', async () => {
    await expect(getMyJobMatchAction('job-1')).resolves.toEqual({ status: 'disabled' });
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'disabled' });
    expect(portal.getPortalIdentity).not.toHaveBeenCalled();
    expect(portal.withPortalTransaction).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT czyta profil kandydata w transakcji sesji', async () => {
    recruitment();
    await expect(getMyJobMatchAction('job-1')).resolves.toEqual({ status: 'none' });
    expect(portal.withPortalTransaction).toHaveBeenCalledTimes(1);
    expect(fakeDb.callsTo('matching.candidate-profile')).toHaveLength(1);
  });
});

describe('#1133: panel pracodawcy bez kandydatów i dopasowań', () => {
  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'employer' });
    vi.mocked(getActiveCompany).mockResolvedValue({
      activeId: 'company-1', activeStatus: 'verified', activeName: 'Firma', activeRole: 'owner', companies: [],
    } as never);
    fakeDb.count('employer.overview-active-jobs', 2);
    fakeDb.count('employer.overview-new-applications', 1);
    fakeDb.count('employer.overview-matched-candidates', 7);
    fakeDb.count('employer.overview-awaiting-reply', 0);
    fakeDb.rpc('get_company_top_matches', []);
    fakeDb.rpc('get_company_matches_page', []);
    // #1147: tryb ogłoszeniowy — kafelki przeglądu czytają lejek ofert (wyświetlenia, kliknięcia).
    fakeDb.rpc('get_company_job_funnel', []);
    const jobRow = {
      id: '33333333-3333-4333-8333-333333333333', title: 'Magazynier', city: 'Gent', status: 'active', slug: 'magazynier',
      expires_at: null, created_at: '2026-09-20T10:00:00Z', new_applications: 1, matched: 4,
    };
    fakeDb.rows('employer.jobs-page', [jobRow]);
  });

  it('loadery kandydatów/top dopasowanych/szczegółu → disabled bez zapytań', async () => {
    await expect(employer.getTopMatchedCandidatesLoad()).resolves.toEqual({ status: 'disabled' });
    await expect(employer.getTopMatchedCandidates()).resolves.toEqual([]);
    await expect(employer.getMatchedCandidatesPage()).resolves.toEqual({ status: 'disabled' });
    await expect(employer.getEmployerCandidateDetail(CANDIDATE)).resolves.toEqual({ status: 'disabled' });
    expect(getActiveCompany).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('przegląd i lista ofert bez pól dopasowań i bez zapytań do matches', async () => {
    const overview = await employer.getEmployerOverview();
    expect(overview.status).toBe('ok');
    expect(overview.status === 'ok' && overview.overview).not.toHaveProperty('matchedCandidatesCount');
    const jobs = await employer.getCompanyJobsLoad();
    expect(jobs.status === 'ok' && jobs.jobs[0]).not.toHaveProperty('matched');
    expect(fakeDb.callsTo('employer.overview-matched-candidates')).toEqual([]);
    for (const call of fakeDb.calls) expect(call.text).not.toMatch(/public\.matches/);
  });

  it('kontrola ujemna: tryb RECRUITMENT liczy dopasowania i woła RPC rankingu', async () => {
    recruitment();
    const overview = await employer.getEmployerOverview();
    expect(overview.status === 'ok' && overview.overview.matchedCandidatesCount).toBe(7);
    const jobs = await employer.getCompanyJobsLoad();
    expect(jobs.status === 'ok' && jobs.jobs[0]?.matched).toBe(4);
    expect(fakeDb.callsTo('employer.jobs-page')[0]!.text).toMatch(/public\.matches/);
    await employer.getTopMatchedCandidatesLoad();
    expect(fakeDb.callsTo('get_company_top_matches')).toHaveLength(1);
  });
});

describe('#1139: kandydat bez polecanych ofert z profilu', () => {
  beforeEach(() => {
    resetFakeDb({ id: USER, role: 'candidate' });
    fakeDb.rows('candidate.recommended-matches', []);
  });

  it('getRecommendedJobs → pusto, bez zapytań (także do matches)', async () => {
    await expect(getRecommendedJobs('pl', true)).resolves.toEqual([]);
    expect(portal.withPortalTransaction).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT czyta public.matches', async () => {
    recruitment();
    await getRecommendedJobs('pl').catch(() => []);
    expect(fakeDb.callsTo('candidate.recommended-matches')).toHaveLength(1);
  });

  it('powiadomienie o ofercie nie prowadzi do /candidate/oferty-polecane (404)', () => {
    expect(resolveHref('job', 'candidate')).toBe('/oferty-pracy');
    expect(resolveHref('job', 'employer')).toBe('/employer/oferty');
    recruitment();
    expect(resolveHref('job', 'candidate')).toBe('/candidate/oferty-polecane');
  });
});
