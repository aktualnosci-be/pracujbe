import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getMyJobMatch } from '@/lib/data/matching';
import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { createServerClient } from '@/lib/supabase/server';

/**
 * #197: dopasowanie nie jest liczone z niepełnych danych. Błąd KAŻDEGO z pięciu odczytów
 * (profil, umiejętności, języki, certyfikaty, RPC oferty) → `error` + telemetria, nigdy
 * procent ani udawany brak profilu/oferty. Pusta relacja po sukcesie to nadal wynik.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn() }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

type Read = 'candidate_profiles' | 'candidate_skills' | 'candidate_languages' | 'candidate_certificates' | 'get_job_match_profile';
const READS: Read[] = ['candidate_profiles', 'candidate_skills', 'candidate_languages', 'candidate_certificates', 'get_job_match_profile'];
const readError = { code: 'read-failed', message: 'relation does not exist' };

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

function client({ failed = null, profile = PROFILE, jobRows = [JOB], relations = {} }: Options = {}) {
  const result = (read: Read, data: unknown) => (failed === read ? { data: null, error: readError } : { data, error: null });
  const rows: Record<string, unknown[]> = {
    candidate_skills: [{ skill_label: 'Wózek widłowy' }],
    candidate_languages: [{ language_label: 'nl' }],
    candidate_certificates: [],
    ...relations,
  };
  const query = (table: Read) => {
    const q: Record<string, unknown> = {};
    for (const method of ['select', 'eq']) q[method] = vi.fn(() => q);
    q['maybeSingle'] = vi.fn(async () => result(table, profile));
    q['then'] = (ok: (v: unknown) => unknown, fail: (r: unknown) => unknown) =>
      Promise.resolve(result(table, rows[table])).then(ok, fail);
    return q;
  };
  vi.mocked(createServerClient).mockResolvedValue({
    auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'user-1' } } })) },
    from: vi.fn((table: Read) => query(table)),
    rpc: vi.fn(async () => result('get_job_match_profile', jobRows)),
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});

describe('getMyJobMatch (#197)', () => {
  it('po udanych odczytach zwraca wynik', async () => {
    client();
    const load = await getMyJobMatch('job-1');
    expect(load.status).toBe('ok');
    expect(load.status === 'ok' && load.result.score).toBeGreaterThan(0);
    expect(captureError).not.toHaveBeenCalled();
  });

  it.each(READS)('błąd odczytu %s → error z telemetrią, bez procentu', async (read) => {
    client({ failed: read });
    const load = await getMyJobMatch('job-1');
    expect(load).toEqual({ status: 'error' });
    expect(load).not.toHaveProperty('result');
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'matching.getMyJobMatch', source: read });
  });

  it('wyjątek klienta → error (nie null/brak profilu)', async () => {
    vi.mocked(createServerClient).mockRejectedValue(new Error('network'));
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledTimes(1);
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

  it('bez konfiguracji (demo) → none', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    await expect(getMyJobMatch('job-1')).resolves.toEqual({ status: 'none' });
  });
});
