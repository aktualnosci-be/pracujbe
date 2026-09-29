// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #775 — po zmianie cyklu życia oferty (publikacja, pauza/wznowienie/zamknięcie/ponowne
 * otwarcie, automatyczne wygaśnięcie z maintenance) publiczne strony ISR (szczegół, strona
 * główna, landingi kategorii/miasta) muszą przestać serwować stary stan z cache — bez
 * czekania na okno rewalidacji (60 s). Kontrola ujemna: brak zmiany (0 wygaszonych ofert)
 * nie wywołuje żadnej rewalidacji.
 */

const revalidatePath = vi.fn();
vi.mock('next/cache', () => ({ revalidatePath }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { PUBLIC_JOB_ROUTES } = await import('@/lib/jobs/public-cache');
const PUBLIC_CALLS = PUBLIC_JOB_ROUTES.map((path) => [path, 'page']);

const JOB_ID = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

function publicPathCalls(): unknown[] {
  return revalidatePath.mock.calls.filter(
    (call) => typeof call[0] === 'string' && (PUBLIC_JOB_ROUTES as readonly string[]).includes(call[0]),
  );
}

describe('publishJob i setJobStatus unieważniają publiczne strony ISR (#775)', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    const { resetFakeDb } = await import('../helpers/fake-db');
    resetFakeDb({ id: USER, role: 'employer' });
  });

  it('publishJob po udanej publikacji rewaliduje stronę główną, szczegół i landingi', async () => {
    const { fakeDb } = await import('../helpers/fake-db');
    fakeDb.rpc('publish_job', 'oferta-abc123');
    fakeDb.rows('jobs.publish-title', [{ id: JOB_ID, title: 'Magazynier' }]);

    const { publishJob } = await import('@/lib/actions/jobs');
    const result = await publishJob(JOB_ID);

    expect(result).toEqual({ ok: true });
    const calls = publicPathCalls();
    expect(calls).toEqual(PUBLIC_CALLS);
  });

  it('kontrola ujemna: nieudana publikacja (brak oferty) nie rewaliduje niczego', async () => {
    const { fakeDb } = await import('../helpers/fake-db');
    fakeDb.rows('jobs.publish-title', []);

    const { publishJob } = await import('@/lib/actions/jobs');
    const result = await publishJob(JOB_ID);

    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(publicPathCalls()).toEqual([]);
  });

  it.each(['pause', 'resume', 'close', 'reopen'] as const)(
    'setJobStatus(%s) po sukcesie rewaliduje publiczne strony',
    async (action) => {
      const { fakeDb } = await import('../helpers/fake-db');
      fakeDb.rpc('set_job_status', action === 'reopen' || action === 'resume' ? 'active' : 'closed');

      const { setJobStatus } = await import('@/lib/actions/jobs');
      const result = await setJobStatus(JOB_ID, action);

      expect(result.ok).toBe(true);
      expect(publicPathCalls()).toEqual(PUBLIC_CALLS);
    },
  );

  it('kontrola ujemna: błąd RPC set_job_status nie rewaliduje niczego', async () => {
    const { fakeDb, pgError } = await import('../helpers/fake-db');
    fakeDb.rpc('set_job_status', () => {
      throw pgError('42501', 'VALIDATION_FAILED: nie można wznowić zamkniętej oferty');
    });

    const { setJobStatus } = await import('@/lib/actions/jobs');
    const result = await setJobStatus(JOB_ID, 'resume');

    expect(result).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(publicPathCalls()).toEqual([]);
  });
});
