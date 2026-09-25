import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCandidatePassport } from '@/lib/data/candidate';
import { captureError } from '@/lib/sentry';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const OWNER = '11111111-1111-4111-8111-111111111111';

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: OWNER, role: 'candidate' });
});

describe('paszport zawodowy kandydata', () => {
  it('czyta wyłącznie profil właściciela i zachowuje zero lat doświadczenia', async () => {
    fakeDb.rows('candidate.passport', [{
      occupations: ['Magazynier'], city: 'Gent', radius_km: 25, experience_years: 0, availability: 'immediate',
      skills: ['VCA'], languages: ['Nederlands'], certificates: ['ADR'],
    }]);

    await expect(getCandidatePassport()).resolves.toMatchObject({
      loadFailed: false,
      occupations: ['Magazynier'], city: 'Gent', radiusKm: 25, experienceYears: 0,
      skills: ['VCA'], languages: ['Nederlands'], certificates: ['ADR'],
    });
    const [call] = fakeDb.callsTo('candidate.passport');
    expect(call).toMatchObject({ as: OWNER, values: [OWNER] });
    expect(call!.text).toContain('cp.profile_id = $1 AND cp.deleted_at IS NULL');
    // Relacje wyłącznie po id tego profilu.
    for (const table of ['candidate_skills', 'candidate_languages', 'candidate_certificates']) {
      expect(call!.text).toMatch(new RegExp(`${table} \\w+\\s+WHERE \\w+\\.candidate_profile_id = cp\\.id`));
    }
  });

  it('bez sesji nie pobiera ani nie pokazuje danych zawodowych', async () => {
    fakeSession.identity = null;
    await expect(getCandidatePassport()).resolves.toMatchObject({ loadFailed: false, occupations: [], skills: [] });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('pusty profil oznacza brak danych, a nie awarię', async () => {
    fakeDb.rows('candidate.passport', []);
    await expect(getCandidatePassport()).resolves.toMatchObject({ loadFailed: false, occupations: [] });
  });

  it('błąd odczytu nie udaje pustego pola', async () => {
    const failedRead = pgError('08006', 'database-unavailable');
    fakeDb.rows('candidate.passport', () => { throw failedRead; });
    await expect(getCandidatePassport()).resolves.toMatchObject({ loadFailed: true });
    expect(captureError).toHaveBeenCalledWith(failedRead, { area: 'candidate.getCandidatePassport' });
  });
});
