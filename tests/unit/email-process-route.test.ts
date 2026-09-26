// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `/api/email/process` (#78): jeden chroniony endpoint crona Railway obsługuje domenową kolejkę
 * `email_deliveries` i kolejkę wiadomości kont `auth.email_outbox`. Bez sekretu 401 (żaden worker
 * nie rusza), a problem którejkolwiek kolejki (brak konfiguracji w produkcji, błąd claimu/ACK)
 * nie jest maskowany jako sukces — 503.
 */

const { processEmailQueue, processAuthEmailQueue } = vi.hoisted(() => ({
  processEmailQueue: vi.fn(),
  processAuthEmailQueue: vi.fn(),
}));
vi.mock('@/lib/email/outbox', () => ({ processEmailQueue }));
vi.mock('@/lib/auth/email-worker', () => ({ processAuthEmailQueue }));

import { GET, POST } from '@/app/api/email/process/route';

const SECRET = 'queue-secret-for-tests-only-0123456789';
const okDomain = { processed: 0, sent: 0, failed: 0, ok: true };
const okAuth = { processed: 1, sent: 1, failed: 0, expired: 0, stale: 0, ackErrors: 0, ok: true };

function request(method: 'GET' | 'POST', authorization?: string) {
  return new Request('https://pracuj.be/api/email/process', {
    method,
    headers: authorization ? { authorization } : {},
  });
}

beforeEach(() => {
  vi.stubEnv('EMAIL_QUEUE_SECRET', SECRET);
  vi.stubEnv('CRON_SECRET', '');
  processEmailQueue.mockReset().mockResolvedValue(okDomain);
  processAuthEmailQueue.mockReset().mockResolvedValue(okAuth);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('/api/email/process', () => {
  it.each([undefined, 'Bearer zly-sekret', SECRET, `Basic ${SECRET}`])(
    'bez poprawnego sekretu (%s) → 401 i żaden worker nie rusza',
    async (authorization) => {
      const response = await POST(request('POST', authorization));
      expect(response.status).toBe(401);
      expect(processEmailQueue).not.toHaveBeenCalled();
      expect(processAuthEmailQueue).not.toHaveBeenCalled();
    },
  );

  it('sekret → obie kolejki; wynik auth w odpowiedzi i 200', async () => {
    const response = await POST(request('POST', `Bearer ${SECRET}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, auth: okAuth });
    expect(processEmailQueue).toHaveBeenCalledTimes(1);
    expect(processAuthEmailQueue).toHaveBeenCalledTimes(1);
  });

  it('GET (#583) jest bezpieczne — 405 bez autoryzacji ani wywołania workerów', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(processEmailQueue).not.toHaveBeenCalled();
    expect(processAuthEmailQueue).not.toHaveBeenCalled();
  });

  it('kolejka auth nieskonfigurowana w produkcji → 503, nawet gdy domenowa jest zdrowa', async () => {
    processAuthEmailQueue.mockResolvedValueOnce({ ...okAuth, processed: 0, sent: 0, skipped: 'auth mail not configured', ok: false });
    const response = await POST(request('POST', `Bearer ${SECRET}`));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false, auth: { skipped: 'auth mail not configured' } });
  });

  it('błąd zapisu ACK w kolejce auth → 503', async () => {
    processAuthEmailQueue.mockResolvedValueOnce({ ...okAuth, sent: 0, ackErrors: 1, ok: false });
    expect((await POST(request('POST', `Bearer ${SECRET}`))).status).toBe(503);
  });

  it('problem kolejki domenowej → 503 (stara kolejka dalej obsługiwana)', async () => {
    processEmailQueue.mockResolvedValueOnce({ ...okDomain, ok: false, skipped: 'claim error' });
    expect((await POST(request('POST', `Bearer ${SECRET}`))).status).toBe(503);
  });
});
