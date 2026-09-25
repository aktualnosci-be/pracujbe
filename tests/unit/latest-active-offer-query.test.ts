import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getLatestActiveOffer } from '@/lib/data/candidate';
import { captureError } from '@/lib/error-report';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const CANDIDATE = '22222222-2222-4222-8222-222222222222';

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: CANDIDATE, role: 'candidate' });
});

describe('getLatestActiveOffer', () => {
  it('filters active and unexpired rows before a deterministic limit 1', async () => {
    fakeDb.rows('candidate.latest-active-offer', []);

    await expect(getLatestActiveOffer('pl')).resolves.toBeNull();

    const [call] = fakeDb.callsTo('candidate.latest-active-offer');
    expect(call).toMatchObject({ as: CANDIDATE, values: [CANDIDATE] });
    const sql = call!.text.replace(/\s+/g, ' ');
    expect(sql).toContain('FROM public.offers');
    expect(sql).toContain('candidate_id = $1');
    expect(sql).toContain("status IN ('sent', 'viewed')");
    expect(sql).toContain('sent_at IS NOT NULL');
    expect(sql).toContain('(expires_at IS NULL OR expires_at > now())');
    expect(sql).toContain('ORDER BY sent_at DESC, id DESC LIMIT 1');
    // Filtry przed limitem (w jednym zapytaniu), bez odczytu metadanych, gdy brak wiersza.
    expect(sql.indexOf('WHERE')).toBeLessThan(sql.indexOf('LIMIT 1'));
    expect(fakeDb.calls).toHaveLength(1);

    const readError = pgError('XX000', 'read-failed');
    fakeDb.rows('candidate.latest-active-offer', () => { throw readError; });
    await expect(getLatestActiveOffer('pl')).resolves.toBeNull();
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'candidate.getLatestActiveOffer' });
  });

  it('wzbogaca propozycję danymi oferty z własnych aplikacji, potem z propozycji', async () => {
    fakeDb
      .rows('candidate.latest-active-offer', [{ id: 'offer-1', job_id: 'job-2', status: 'sent', message: '', sent_at: '2026-09-20T09:00:00+00:00', expires_at: null }])
      .rpc('get_applied_jobs_display', [])
      .rpc('get_offered_jobs_display', [{ job_id: 'job-2', slug: 'kierowca', title: 'Kierowca', company_name: 'Firma', city: 'Gent' }]);
    await expect(getLatestActiveOffer('pl')).resolves.toMatchObject({ id: 'offer-1', jobTitle: 'Kierowca', companyName: 'Firma', slug: 'kierowca' });
    expect(fakeDb.callsTo('get_offered_jobs_display')[0]!.args).toEqual({ p_locale: 'pl' });
    expect(fakeDb.callsTo('get_applied_jobs_display')[0]!.args).toEqual({ p_locale: 'pl', p_job_ids: ['job-2'] });
  });
});
