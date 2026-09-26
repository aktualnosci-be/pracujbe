// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** #33 — `/api/translation/process`: sekret, flaga domyślnie wyłączona, 503 bez szczegółów. */

// --- Trasa crona -------------------------------------------------------------------------------
const { runQueue, isServiceDatabaseConfigured } = vi.hoisted(() => ({
  runQueue: vi.fn(),
  isServiceDatabaseConfigured: vi.fn(() => true),
}));
vi.mock('@/lib/db/portal', () => ({ isServiceDatabaseConfigured, withServiceRole: vi.fn() }));
vi.mock('@/lib/translation/run', async (orig) => ({
  ...(await orig<typeof import('@/lib/translation/run')>()),
  runTranslationQueue: runQueue,
}));

const SECRET = 'maintenance-secret-for-tests-0123456789';
const req = (auth?: string) =>
  new Request('https://pracuj.be/api/translation/process', { method: 'POST', headers: auth ? { authorization: auth } : {} });

describe('/api/translation/process', () => {
  beforeEach(() => {
    vi.stubEnv('MAINTENANCE_SECRET', SECRET);
    vi.stubEnv('CRON_SECRET', '');
    vi.stubEnv('APP_MODE', '');
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    runQueue.mockReset().mockResolvedValue({ batches: 1, claimed: 0, applied: 0, proposals: 0, superseded: 0, retried: 0, deferred: 0, failed: 0, dropped: 0 });
  });
  afterEach(() => vi.unstubAllEnvs());

  it('bez sekretu → 401, worker nie rusza', async () => {
    const { POST } = await import('@/app/api/translation/process/route');
    expect((await POST(req())).status).toBe(401);
    expect((await POST(req('Bearer zly'))).status).toBe(401);
    expect(runQueue).not.toHaveBeenCalled();
  });

  it('flaga wyłączona (domyślnie) → skipped, bez bazy i dostawcy', async () => {
    vi.stubEnv('AI_TRANSLATION_ENABLED', '');
    const { POST } = await import('@/app/api/translation/process/route');
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, skipped: 'disabled' });
    expect(runQueue).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: flaga + atrapa → worker rusza', async () => {
    vi.stubEnv('AI_TRANSLATION_ENABLED', '1');
    vi.stubEnv('AI_TRANSLATION_PROVIDER', 'fixture');
    const { POST } = await import('@/app/api/translation/process/route');
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(runQueue).toHaveBeenCalledTimes(1);
  });

  it('błąd kolejki → 503 bez szczegółów', async () => {
    vi.stubEnv('AI_TRANSLATION_ENABLED', '1');
    vi.stubEnv('AI_TRANSLATION_PROVIDER', 'fixture');
    runQueue.mockRejectedValueOnce(new Error('translation_claim_failed'));
    const { POST } = await import('@/app/api/translation/process/route');
    const res = await POST(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(503);
    expect(JSON.stringify(await res.json())).not.toContain('claim');
  });

  it('GET (#614) jest bezpieczne — 405 z Allow: POST, bez sekretu, bez kolejki i dostawcy', async () => {
    vi.stubEnv('AI_TRANSLATION_ENABLED', '1');
    vi.stubEnv('AI_TRANSLATION_PROVIDER', 'fixture');
    const route = await import('@/app/api/translation/process/route');
    const res = await (route.GET as () => Promise<Response>)();
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
    expect(runQueue).not.toHaveBeenCalled();
    // Kontrola ujemna: ta sama konfiguracja przez POST z sekretem uruchamia worker.
    expect((await route.POST(req(`Bearer ${SECRET}`))).status).toBe(200);
    expect(runQueue).toHaveBeenCalledTimes(1);
  });
});
