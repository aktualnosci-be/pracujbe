import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyJobMatch } from '@/lib/data/matching';
import { captureError } from '@/lib/error-report';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #197: dopasowanie nie jest liczone z niepełnych danych. Błąd KAŻDEGO z sześciu odczytów
 * (profil, umiejętności, języki, certyfikaty, RPC oferty, słownik lokalizacji) → `error` + telemetria, nigdy
 * procent ani udawany brak profilu/oferty. Pusta relacja po sukcesie to nadal wynik.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

type Read = 'candidate_profiles' | 'candidate_skills' | 'candidate_languages' | 'candidate_certificates' | 'get_job_match_profile' | 'locations';
const READS: Read[] = ['candidate_profiles', 'candidate_skills', 'candidate_languages', 'candidate_certificates', 'get_job_match_profile', 'locations'];
const readError = pgError('42P01', 'relation does not exist');
const USER = '11111111-1111-4111-8111-111111111111';

const JOB = {
  occupation: 'forklift', category: 'warehouse', skills: ['Wózek widłowy'], mandatory_skills: ['Wózek widłowy'],
  city: 'Gent', region: 'Oost-Vlaanderen', min_experience_years: 1, languages: ['nl'], certificates: [],
  requires_driving_license: false, contract_type: 'permanent', start_immediately: true, remote: false,
};
const PROFILE = {
  id: 'cp-1', occupations: ['forklift'], categories: ['warehouse'], preferred_contract_types: ['permanent'],
  city: 'Gent', region: 'Oost-Vlaanderen', radius_km: 30, has_driving_license: true, has_car: true,
  experience_years: 3, availability: 'immediate',
};

interface Options {
  failed?: Read | null;
  profile?: unknown;
  jobRows?: unknown[];
  relations?: Partial<Record<Read, unknown[]>>;
}

/** Nazwy zapytań loadera → źródło odczytu raportowane w telemetrii. */
const QUERY_BY_READ: Record<Exclude<Read, 'get_job_match_profile'>, string> = {
  candidate_profiles: 'matching.candidate-profile',
  candidate_skills: 'matching.candidate-skills',
  candidate_languages: 'matching.candidate-languages',
  candidate_certificates: 'matching.candidate-certificates',
  locations: 'matching.locations',
};

function client({ failed = null, profile = PROFILE, jobRows = [JOB], relations = {} }: Options = {}) {
  resetFakeDb({ id: USER, role: 'candidate' });
  const result = (read: Read, data: unknown) => () => {
    if (failed === read) throw readError;
    return data;
  };
  const rows: Record<string, unknown[]> = {
    candidate_skills: [{ skill_label: 'Wózek widłowy' }],
    candidate_languages: [{ language_label: 'nl' }],
    candidate_certificates: [],
    locations: [],
    ...relations,
  };
  fakeDb.rows(QUERY_BY_READ.candidate_profiles, result('candidate_profiles', profile ? [profile] : []));
  for (const read of ['candidate_skills', 'candidate_languages', 'candidate_certificates', 'locations'] as const) {
    fakeDb.rows(QUERY_BY_READ[read], result(read, rows[read]));
  }
  fakeDb.rpc('get_job_match_profile', result('get_job_match_profile', jobRows));
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getMyJobMatch (#197)', () => {
  it('po udanych odczytach zwraca wynik', async () => {
    client();
    const load = await getMyJobMatch('job-1');
    expect(load.status).toBe('ok');
    expect(load.status === 'ok' && load.result.score).toBeGreaterThan(0);
    expect(captureError).not.toHaveBeenCalled();
    // Profil kandydata wyłącznie właściciela sesji; relacje po id jego profilu.
    expect(fakeDb.callsTo('matching.candidate-profile')[0]).toMatchObject({ as: USER, values: [USER] });
    expect(fakeDb.callsTo('matching.candidate-skills')[0]!.values).toEqual(['cp-1']);
    expect(fakeDb.callsTo('get_job_match_profile')[0]!.args).toEqual({ p_job_id: 'job-1' });
  });

  it.each(READS)('błąd odczytu %s → error z telemetrią, bez procentu', async (read) => {
    client({ failed: read });
    const load = await getMyJobMatch('job-1');
    expect(load).toEqual({ status: 'error' });
    expect(load).not.toHaveProperty('result');
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'matching.getMyJobMatch', source: read });
  });

  it('wyjątek połączenia → error (nie null/brak profilu)', async () => {
    client();
    const network = new Error('network');
    fakeDb.rows(QUERY_BY_READ.candidate_profiles, () => { throw network; });
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledTimes(1);
  });

  it('bez sesji → none, bez zapytań', async () => {
    client();
    fakeSession.identity = null;
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'none' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('udane puste relacje kandydata to nadal wynik (nie błąd)', async () => {
    client({ relations: { candidate_skills: [], candidate_languages: [], candidate_certificates: [] } });
    const load = await getMyJobMatch('job-1');
    expect(load.status).toBe('ok');
    expect(captureError).not.toHaveBeenCalled();
  });

  it('udany odczyt bez profilu kandydata → none', async () => {
    client({ profile: null });
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'none' });
  });

  it('udany odczyt RPC bez wiersza (oferta niepubliczna/nieistniejąca) → none', async () => {
    client({ jobRows: [] });
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'none' });
    expect(captureError).not.toHaveBeenCalled();
  });

  it('przekazuje poziomy języków z obu stron bez utraty informacji (#195)', async () => {
    client({
      jobRows: [{ ...JOB, language_requirements: [{ label: 'nl', level: 'fluent' }] }],
      relations: { candidate_languages: [{ language_label: 'nl', level: 'basic' }] },
    });
    const load = await getMyJobMatch('job-1');
    expect(load.status === 'ok' && load.result.languageGaps).toEqual([
      { language: 'nl', required: 'fluent', actual: 'basic' },
    ]);
  });

  it('liczy odległość ze współrzędnych słownika lokalizacji (#194)', async () => {
    const far = {
      jobRows: [{ ...JOB, city: 'Mechelen', region: 'Flanders' }],
      profile: { ...PROFILE, city: 'Bruges', region: 'Flanders', radius_km: 50 },
      relations: {
        locations: [
          { name: 'Mechelen', slug: 'mechelen', latitude: '51.028100', longitude: '4.477600' },
          { name: 'Bruges', slug: 'bruges', latitude: 51.2097, longitude: 3.2247 },
        ],
      },
    };
    client(far);
    const load = await getMyJobMatch('job-1');
    expect(load.status === 'ok' && load.result.missing).toContain('location');

    client({ ...far, profile: { ...far.profile, radius_km: 100 } });
    const near = await getMyJobMatch('job-1');
    expect(near.status === 'ok' && near.result.strengths).toContain('withinCommuteRadius');
  });

  it('bez konfiguracji (demo) → none', async () => {
    client();
    fakeSession.configured = false;
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'none' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
