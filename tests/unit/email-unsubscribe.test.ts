import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  EMAIL_AUTH_TEMPLATES,
  EMAIL_MARKETING_TEMPLATES,
  EMAIL_TEMPLATE_CATEGORY,
  emailPreferenceCategory,
  emailSendPool,
} from '@/lib/email/categories';
import {
  createUnsubscribeToken,
  UNSUBSCRIBE_TOKEN_TTL_SECONDS,
  verifyUnsubscribeToken,
} from '@/lib/email/unsubscribe-token';

/**
 * #45 — wypisanie jednym kliknięciem: podpisany token (bez PII), endpoint RFC 8058
 * (POST wypisuje idempotentnie, GET nic nie zmienia), stopka i nagłówki w workerze oraz
 * atomowy budżet wysyłki (odmowa = odłożenie bez zwiększania `attempts`).
 */

const { send, adminRpc, adminFrom, updates } = vi.hoisted(() => ({
  send: vi.fn(),
  adminRpc: vi.fn(),
  adminFrom: vi.fn(),
  updates: [] as Array<{ id: unknown; values: Record<string, unknown> }>,
}));

vi.mock('resend', () => ({ Resend: class { emails = { send }; } }));
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ rpc: adminRpc, from: adminFrom }) }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isProductionMode: () => true,
  isSupabaseConfigured: () => process.env.TEST_SUPABASE !== 'off',
}));

const SECRET = 'test-unsubscribe-secret-0123456789abcdef';
const PROFILE = '8f2c1d3e-4b5a-4c6d-8e7f-901234567890';
const NOW = Date.UTC(2026, 8, 24, 12, 0, 0);
const SITE = 'https://pracuj.be';

beforeEach(() => {
  vi.clearAllMocks();
  updates.length = 0;
  process.env.EMAIL_UNSUBSCRIBE_SECRET = SECRET;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-test';
  process.env.RESEND_API_KEY = 're_test';
  process.env.NEXT_PUBLIC_SITE_URL = SITE;
  delete process.env.TEST_SUPABASE;
  send.mockResolvedValue({ data: { id: 'provider-1' }, error: null });
  adminFrom.mockReturnValue({
    update: (values: Record<string, unknown>) => ({
      eq: async (_col: string, id: unknown) => {
        updates.push({ id, values });
        return { error: null };
      },
    }),
    select: () => ({ in: async () => ({ data: [], error: null }) }),
  });
});

describe('token wypisania', () => {
  const token = createUnsubscribeToken({ profileId: PROFILE, category: 'offers' }, SECRET, NOW);

  it('poprawny token zwraca profil, kategorię i termin ważności', () => {
    expect(verifyUnsubscribeToken(token, SECRET, NOW)).toEqual({
      ok: true,
      profileId: PROFILE,
      category: 'offers',
      expiresAt: Math.floor(NOW / 1000) + UNSUBSCRIBE_TOKEN_TTL_SECONDS,
    });
  });

  it('token nie zawiera adresu e-mail ani danych poza UUID, kategorią i datą', () => {
    const [, data] = token.split('.');
    const decoded = Buffer.from(data!, 'base64url').toString('utf8');
    expect(decoded).toBe(`${PROFILE}|offers|${Math.floor(NOW / 1000) + UNSUBSCRIBE_TOKEN_TTL_SECONDS}`);
    expect(token).not.toContain('@');
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it('wygasły token jest odrzucany (także dokładnie w chwili wygaśnięcia)', () => {
    const expiry = (Math.floor(NOW / 1000) + UNSUBSCRIBE_TOKEN_TTL_SECONDS) * 1000;
    expect(verifyUnsubscribeToken(token, SECRET, expiry - 1).ok).toBe(true);
    expect(verifyUnsubscribeToken(token, SECRET, expiry)).toEqual({ ok: false, reason: 'expired' });
  });

  it('zmanipulowane dane (inna kategoria, inny profil, dłuższa ważność) → zły podpis', () => {
    const [v, , sig] = token.split('.');
    const forge = (text: string) => `${v}.${Buffer.from(text).toString('base64url')}.${sig}`;
    const exp = Math.floor(NOW / 1000) + UNSUBSCRIBE_TOKEN_TTL_SECONDS;
    for (const forged of [
      forge(`${PROFILE}|marketing|${exp}`),
      forge(`00000000-0000-4000-8000-000000000000|offers|${exp}`),
      forge(`${PROFILE}|offers|${exp + 86_400}`),
    ]) {
      expect(verifyUnsubscribeToken(forged, SECRET, NOW)).toEqual({ ok: false, reason: 'signature' });
    }
  });

  it('zmieniony podpis albo inny sekret → odrzucenie', () => {
    const last = token.at(-1) === 'A' ? 'B' : 'A';
    expect(verifyUnsubscribeToken(`${token.slice(0, -1)}${last}`, SECRET, NOW).ok).toBe(false);
    expect(verifyUnsubscribeToken(token, `${SECRET}-other`, NOW)).toEqual({ ok: false, reason: 'signature' });
  });

  it('śmieci i puste wartości → malformed, bez wyjątku', () => {
    for (const bad of ['', 'abc', 'v2.a.b', 'v1..x', `${token}.x`, 'v1.' + 'a'.repeat(300) + '.b', null, 42]) {
      expect(verifyUnsubscribeToken(bad, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
    }
  });

  it('zbyt krótki sekret nie podpisuje i nie weryfikuje', () => {
    expect(() => createUnsubscribeToken({ profileId: PROFILE, category: 'offers' }, 'short')).toThrow();
    expect(() => verifyUnsubscribeToken(token, 'short')).toThrow();
  });
});

describe('lustro SQL ↔ TS (migracja 0087)', () => {
  const sql = readFileSync(join(process.cwd(), 'supabase/migrations/0087_email_unsubscribe_budget.sql'), 'utf8');

  it('kategorie typów maili zgodne z email_preference_category', () => {
    const body = sql.slice(sql.indexOf('function public.email_preference_category'), sql.indexOf('revoke all on function public.email_preference_category'));
    const fromSql = Object.fromEntries(
      [...body.matchAll(/when '(\w+)'\s+then '(\w+)'/g)].map((m) => [m[1], m[2]]),
    );
    expect(fromSql).toEqual(EMAIL_TEMPLATE_CATEGORY);
    expect(emailPreferenceCategory('passwordReset')).toBeNull();
    expect(emailPreferenceCategory('jobPublished')).toBeNull();
    expect(emailPreferenceCategory('toString')).toBeNull();
  });

  it('pule budżetu zgodne z email_send_pool', () => {
    const body = sql.slice(sql.indexOf('function public.email_send_pool'), sql.indexOf('revoke all on function public.email_send_pool'));
    const list = (pool: string) =>
      [...body.match(new RegExp(`in \\(([^)]*)\\)\\s+then '${pool}'`))![1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]);
    expect(list('auth')).toEqual([...EMAIL_AUTH_TEMPLATES]);
    expect(list('marketing')).toEqual([...EMAIL_MARKETING_TEMPLATES]);
    expect(emailSendPool('statusChanged')).toBe('transactional');
    expect(emailSendPool('passwordReset')).toBe('auth');
    expect(emailSendPool('newsletter')).toBe('marketing');
  });
});

describe('POST/GET /api/email/unsubscribe', () => {
  async function route() {
    return import('@/app/api/email/unsubscribe/route');
  }
  const token = () => createUnsubscribeToken({ profileId: PROFILE, category: 'messages' }, SECRET);
  const post = (t: string) =>
    new Request(`${SITE}/api/email/unsubscribe?t=${encodeURIComponent(t)}&l=fr`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });

  it('POST wypisuje bez logowania; ponowienie daje ten sam wynik (idempotentnie)', async () => {
    adminRpc.mockResolvedValueOnce({ data: true, error: null }).mockResolvedValueOnce({ data: false, error: null });
    const { POST } = await route();
    const t = token();
    const first = await POST(post(t));
    const second = await POST(post(t));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: 'done' });
    expect(adminRpc).toHaveBeenCalledTimes(2);
    // #45 (0102): źródło one-click i język linku trafiają do dowodu wycofania zgody.
    const call = { p_profile_id: PROFILE, p_category: 'messages', p_source: 'one_click', p_locale: 'fr' };
    expect(adminRpc).toHaveBeenNthCalledWith(1, 'email_unsubscribe', call);
    expect(adminRpc).toHaveBeenNthCalledWith(2, 'email_unsubscribe', call);
    expect(first.headers.get('cache-control')).toBe('no-store');
  });

  it('GET (skaner linków) NIE zmienia preferencji — tylko 303 na stronę w języku odbiorcy', async () => {
    const { GET } = await route();
    const t = token();
    const response = await GET(new Request(`${SITE}/api/email/unsubscribe?t=${encodeURIComponent(t)}&l=fr`));
    expect(response.status).toBe(303);
    const location = new URL(response.headers.get('location')!);
    expect(location.pathname).toBe('/fr/wypisz');
    expect(location.searchParams.get('t')).toBe(t);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('zmanipulowany lub wygasły token → 400 bez zapisu', async () => {
    const { POST } = await route();
    const expired = createUnsubscribeToken({ profileId: PROFILE, category: 'messages' }, SECRET, Date.now() - (UNSUBSCRIBE_TOKEN_TTL_SECONDS + 10) * 1000);
    expect((await POST(post(`${token()}x`))).status).toBe(400);
    const expiredResponse = await POST(post(expired));
    expect(expiredResponse.status).toBe(400);
    expect(await expiredResponse.json()).toEqual({ status: 'expired' });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it('błąd bazy → 500 (klient poczty ponowi), brak konfiguracji → 503', async () => {
    const { POST } = await route();
    adminRpc.mockResolvedValueOnce({ data: null, error: { message: 'db down' } });
    expect((await POST(post(token()))).status).toBe(500);
    process.env.TEST_SUPABASE = 'off';
    expect((await POST(post(token()))).status).toBe(503);
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    expect((await POST(post('v1.a.b'))).status).toBe(503);
  });
});

describe('worker outboxa: wypisanie i budżet', () => {
  function row(id: string, template: string, profileId: string | null = PROFILE) {
    return { id, profile_id: profileId, to_email: `${id}@example.test`, template, locale: 'nl', payload: { companyName: 'Acme', jobTitle: 'Chauffeur' }, attempts: 2 };
  }
  function mockRpc(rows: unknown[], budget: (template: string) => { granted: boolean; retry_at: string | null }) {
    adminRpc.mockImplementation(async (name: string, args: { p_template?: string }) =>
      name === 'take_email_send_budget'
        ? { data: [budget(args.p_template ?? '')], error: null }
        : { data: rows, error: null },
    );
  }

  it('mail z kategorią: nagłówki RFC 8058 i link w stopce w języku odbiorcy', async () => {
    mockRpc([row('d1', 'jobOffer')], () => ({ granted: true, retry_at: null }));
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 1, deferred: 0, ok: true });

    const [message] = send.mock.calls[0]!;
    const header = message.headers['List-Unsubscribe'] as string;
    expect(message.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    const oneClick = new URL(header.slice(1, -1));
    expect(`${oneClick.origin}${oneClick.pathname}`).toBe(`${SITE}/api/email/unsubscribe`);
    expect(oneClick.searchParams.get('l')).toBe('nl');
    const verified = verifyUnsubscribeToken(oneClick.searchParams.get('t'), SECRET);
    expect(verified).toMatchObject({ ok: true, profileId: PROFILE, category: 'offers' });
    expect(header).not.toContain('d1@example.test');
    expect(message.html).toContain(`${SITE}/nl/wypisz?t=`);
    expect(message.html).toContain('Afmelden voor deze e-mails');
  });

  it('mail bez kategorii (jobPublished) i bez profilu: bez linku i nagłówków', async () => {
    mockRpc([row('d1', 'jobPublished'), row('d2', 'jobOffer', null)], () => ({ granted: true, retry_at: null }));
    const { processEmailQueue } = await import('@/lib/email/outbox');
    await processEmailQueue();
    for (const [message] of send.mock.calls) {
      expect(message.headers).toBeUndefined();
      expect(message.html).not.toContain('/wypisz?t=');
    }
  });

  it('payload kolejki nie podstawi własnego adresu wypisania', async () => {
    const evil = { ...row('d1', 'jobPublished'), payload: { jobTitle: 'X', unsubscribeUrl: 'https://evil.example/u' } };
    mockRpc([evil], () => ({ granted: true, retry_at: null }));
    const { processEmailQueue } = await import('@/lib/email/outbox');
    await processEmailQueue();
    expect(send.mock.calls[0]![0].html).not.toContain('evil.example');
  });

  it('odmowa budżetu: brak wysyłki, odłożenie do okna bez zwiększania attempts; reszta puli bez zapytań', async () => {
    const retryAt = '2026-09-24T12:01:00.000Z';
    mockRpc([row('d1', 'statusChanged'), row('d2', 'jobOffer')], () => ({ granted: false, retry_at: retryAt }));
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ processed: 2, sent: 0, failed: 0, deferred: 2, ok: true });
    expect(send).not.toHaveBeenCalled();
    expect(adminRpc.mock.calls.filter(([name]) => name === 'take_email_send_budget')).toHaveLength(1);
    expect(updates).toEqual([
      { id: 'd1', values: { locked_at: null, next_attempt_at: retryAt } },
      { id: 'd2', values: { locked_at: null, next_attempt_at: retryAt } },
    ]);
  });

  it('KONTROLA UJEMNA: przyznany budżet → ta sama paczka wychodzi', async () => {
    mockRpc([row('d1', 'statusChanged'), row('d2', 'jobOffer')], () => ({ granted: true, retry_at: null }));
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 2, deferred: 0 });
  });

  it('marketing bez sekretu wypisania nigdy nie wychodzi (ponowienie, nie wysyłka)', async () => {
    delete process.env.EMAIL_UNSUBSCRIBE_SECRET;
    mockRpc([row('d1', 'jobMatch')], () => ({ granted: true, retry_at: null }));
    const { processEmailQueue } = await import('@/lib/email/outbox');
    expect(await processEmailQueue()).toMatchObject({ sent: 0, failed: 1 });
    expect(send).not.toHaveBeenCalled();
    expect(updates[0]?.values).toMatchObject({ status: 'queued', attempts: 3 });
  });
});
