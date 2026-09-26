import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * P1-03 (0190): worker materializacji `matches`. Wynik = `scoreMatch` z tych samych wejść co
 * szczegół oferty (wspólne `inputs.ts`), zapis tylko przez service_role, same liczniki w wyniku.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { computeSubjectRows, runMatchRecompute, MATCH_MIN_STORED_SCORE } = await import('@/lib/matching/materialize');
const { buildMatchCandidate, buildMatchJob } = await import('@/lib/matching/inputs');
const { scoreMatch } = await import('@/lib/matching/score');
const { captureError } = await import('@/lib/error-report');

const CAND = '11111111-1111-4111-8111-111111111111';
const JOB_GOOD = 'a1111111-1111-4111-8111-111111111111';
const JOB_LOW = 'b1111111-1111-4111-8111-111111111111';

const candidate = {
  profile_id: CAND,
  occupations: ['magazynier'],
  categories: ['warehouse'],
  preferred_contract_types: ['permanent'],
  city: 'Antwerpen',
  region: 'Flandria',
  radius_km: 30,
  has_driving_license: true,
  has_car: true,
  experience_years: 4,
  availability: 'immediate',
  skills: [{ skill_label: 'wózek widłowy' }],
  languages: [{ language_label: 'Nederlands', level: 'fluent' }],
  certificates: [{ certificate_label: 'VCA', expires_at: '2099-01-01' }],
};
const jobGood = {
  job_id: JOB_GOOD,
  occupation: 'magazynier',
  category: 'warehouse',
  city: 'Antwerpia',
  region: 'Flandria',
  remote: false,
  min_experience_years: 2,
  requires_driving_license: true,
  contract_type: 'permanent',
  start_immediately: true,
  skills: ['wózek widłowy'],
  mandatory_skills: ['wózek widłowy'],
  languages: ['Nederlands'],
  certificates: ['VCA'],
  language_requirements: [{ label: 'Nederlands', level: 'intermediate' }],
};
const jobLow = {
  ...jobGood,
  job_id: JOB_LOW,
  occupation: 'kucharz',
  category: 'hospitality',
  city: 'Liège',
  region: 'Walonia',
  contract_type: 'temporary',
  skills: ['grill'],
  mandatory_skills: ['grill'],
  certificates: ['HACCP'],
  language_requirements: [{ label: 'Français', level: 'native' }],
  languages: ['Français'],
};
const TODAY = '2026-09-26';

describe('computeSubjectRows', () => {
  it('ten sam wynik co scoreMatch na szczególe oferty; zapis tylko ≥ progu, rozważone = wszystkie', () => {
    const inputs = { eligible: true, candidates: [candidate], jobs: [jobGood, jobLow] };
    const { considered, rows } = computeSubjectRows('candidate', inputs, [], TODAY);
    expect(considered).toEqual([JOB_GOOD, JOB_LOW]);
    const expected = scoreMatch(
      buildMatchCandidate(candidate, candidate, []),
      buildMatchJob(jobGood, []),
      { today: TODAY },
    );
    expect(expected.score).toBeGreaterThanOrEqual(MATCH_MIN_STORED_SCORE);
    expect(rows).toEqual([
      {
        other_id: JOB_GOOD,
        score: expected.score,
        matched: expected.matched,
        missing: expected.missing,
        strengths: expected.strengths,
        mandatory_met: expected.mandatoryMet,
        mandatory_total: expected.mandatoryTotal,
        summary_key: expected.summaryKey,
      },
    ]);
  });

  it('podmiot niekwalifikujący się (baza: eligible=false) → nic do zapisu, nic rozważonego', () => {
    // KONTROLA UJEMNA: dane przyszłyby, ale bez `eligible: true` worker ich nie liczy.
    expect(computeSubjectRows('candidate', { eligible: false, candidates: [candidate], jobs: [jobGood] }, [], TODAY))
      .toEqual({ considered: [], rows: [] });
  });

  it('kind=job liczy tę samą parę (symetria) — other_id = kandydat', () => {
    const byJob = computeSubjectRows('job', { eligible: true, jobs: [jobGood], candidates: [candidate] }, [], TODAY);
    const byCandidate = computeSubjectRows('candidate', { eligible: true, candidates: [candidate], jobs: [jobGood] }, [], TODAY);
    expect(byJob.considered).toEqual([CAND]);
    expect({ ...byJob.rows[0], other_id: null }).toEqual({ ...byCandidate.rows[0], other_id: null });
  });

  it('wygasły certyfikat (data odniesienia) obniża wynik — dzień z opcji, nie z zegara', () => {
    const expired = { ...candidate, certificates: [{ certificate_label: 'VCA', expires_at: '2026-09-25' }] };
    const [valid] = computeSubjectRows('candidate', { eligible: true, candidates: [candidate], jobs: [jobGood] }, [], TODAY).rows;
    const [lapsed] = computeSubjectRows('candidate', { eligible: true, candidates: [expired], jobs: [jobGood] }, [], TODAY).rows;
    expect(Number(lapsed!.score)).toBeLessThan(Number(valid!.score));
  });
});

describe('runMatchRecompute', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    resetFakeDb(null);
  });

  function registerHappyPath() {
    let claims = 0;
    fakeDb.rpc('match_recompute_claim', () =>
      claims++ === 0 ? [{ kind: 'candidate', subject_id: CAND, version: 3 }] : [],
    );
    fakeDb.rpc('match_recompute_inputs', { eligible: true, candidates: [candidate], jobs: [jobGood, jobLow] });
    fakeDb.rows('matching.locations', [{ alias_key: 'antwerpen', latitude: '51.2194', longitude: '4.4025' }]);
    fakeDb.rpc('match_recompute_apply', { upserted: 1, deleted: 1, skipped: 0 });
  }

  it('claim → inputs → apply jako service_role; wersja z claimu; wynik = same liczniki', async () => {
    registerHappyPath();
    const run = await runMatchRecompute({ now: () => new Date('2026-09-26T10:00:00Z') });
    expect(run).toEqual({ subjects: 1, failed: 0, upserted: 1, deleted: 1, skipped: 0 });
    expect(fakeDb.calls.every((c) => c.as === 'service')).toBe(true);
    const [inputs] = fakeDb.callsTo('match_recompute_inputs');
    expect(inputs!.args).toMatchObject({ p_kind: 'candidate', p_subject: CAND, p_limit: 500 });
    const [apply] = fakeDb.callsTo('match_recompute_apply');
    expect(apply!.args).toMatchObject({ p_kind: 'candidate', p_subject: CAND, p_version: 3 });
    expect(JSON.parse(String(apply!.args['p_considered']))).toEqual([JOB_GOOD, JOB_LOW]);
    const rows = JSON.parse(String(apply!.args['p_rows'])) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r['other_id'])).toEqual([JOB_GOOD]);
    // Wynik bez identyfikatorów i treści profilu.
    expect(JSON.stringify(run)).not.toMatch(/1111|magazynier|wózek/);
  });

  it('niekwalifikujący się podmiot: apply z pustymi listami (baza usuwa jego wiersze)', async () => {
    registerHappyPath();
    fakeDb.rpc('match_recompute_inputs', { eligible: false, candidates: [], jobs: [] });
    await runMatchRecompute();
    const [apply] = fakeDb.callsTo('match_recompute_apply');
    expect(JSON.parse(String(apply!.args['p_considered']))).toEqual([]);
    expect(JSON.parse(String(apply!.args['p_rows']))).toEqual([]);
    expect(fakeDb.callsTo('matching.locations')).toHaveLength(0);
  });

  it('błąd jednego podmiotu: licznik failed, bez apply, reszta partii dalej; log bez UUID', async () => {
    const OTHER = '22222222-2222-4222-8222-222222222222';
    let claims = 0;
    fakeDb.rpc('match_recompute_claim', () =>
      claims++ === 0
        ? [{ kind: 'candidate', subject_id: CAND, version: 1 }, { kind: 'candidate', subject_id: OTHER, version: 1 }]
        : [],
    );
    fakeDb.rpc('match_recompute_inputs', ({ args }: { args: Record<string, unknown> }) => {
      if (args['p_subject'] === CAND) throw pgError('XX000', 'boom');
      return { eligible: true, candidates: [{ ...candidate, profile_id: OTHER }], jobs: [jobGood] };
    });
    fakeDb.rows('matching.locations', []);
    fakeDb.rpc('match_recompute_apply', { upserted: 1, deleted: 0, skipped: 0 });
    const run = await runMatchRecompute();
    expect(run).toMatchObject({ subjects: 2, failed: 1, upserted: 1 });
    expect(fakeDb.callsTo('match_recompute_apply').map((c) => c.args['p_subject'])).toEqual([OTHER]);
    expect(captureError).toHaveBeenCalledWith(expect.anything(), { area: 'matching.materialize', kind: 'candidate' });
  });

  it('limit podmiotów na przebieg: claim nigdy nie prosi o więcej niż zostało', async () => {
    fakeDb.rpc('match_recompute_claim', ({ args }: { args: Record<string, unknown> }) =>
      Array.from({ length: Number(args['p_limit']) }, (_, i) => ({
        kind: 'job',
        subject_id: `a1111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
        version: 1,
      })),
    );
    fakeDb.rpc('match_recompute_inputs', { eligible: false, candidates: [], jobs: [] });
    fakeDb.rpc('match_recompute_apply', { upserted: 0, deleted: 0, skipped: 0 });
    const run = await runMatchRecompute({ maxSubjects: 7, claimLimit: 5 });
    expect(run.subjects).toBe(7);
    expect(fakeDb.callsTo('match_recompute_claim').map((c) => c.args['p_limit'])).toEqual([5, 2]);
  });

  it('awaria claimu → wyjątek (maintenance zgłasza 503, bez pozornego sukcesu)', async () => {
    fakeDb.rpc('match_recompute_claim', () => {
      throw pgError('42501', 'permission denied');
    });
    await expect(runMatchRecompute()).rejects.toThrow();
  });
});
