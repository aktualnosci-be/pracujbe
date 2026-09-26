import { beforeEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';

/**
 * Endpoint baneru kampanii (#175): uwierzytelnienie, limit, jednakowy 404 dla każdej oferty,
 * której baza nie zwraca (nieaktywna/wygasła/demo/cudza — filtry w 0102, dowód rls.sql CJ186),
 * nagłówki noindex/no-store/CSP i brak PII w wyniku.
 */

const state = vi.hoisted(() => ({
  configured: true,
  user: { id: 'u-1' } as { id: string } | null,
  allowed: true,
  rows: [] as unknown[] | null,
  error: null as unknown,
  rpc: vi.fn(),
  rateLimit: vi.fn(),
}));

// #25: sesja i odczyt przez warstwę danych (`withPortalTransaction` + RPC pod sesją).
vi.mock('@/lib/db/portal', () => ({
  isPortalDataConfigured: () => state.configured,
  getPortalIdentity: async () => (state.user ? { id: state.user.id, role: 'employer' } : null),
  withPortalTransaction: async (
    identity: { id: string } | null,
    action: (tx: { query: (text: string, values?: unknown[]) => Promise<unknown> }) => Promise<unknown>,
  ) => action({
    query: async (text: string, values: unknown[] = []) => {
      const fn = /^\/\* rpcrows:([a-z_]+) \*\//.exec(text)?.[1];
      if (!fn) throw new Error(`nieoczekiwane zapytanie: ${text.slice(0, 60)}`);
      const args: Record<string, unknown> = {};
      for (const m of text.matchAll(/([a-z_]+) => \$(\d+)/g)) args[m[1]!] = values[Number(m[2]) - 1];
      state.rpc(fn, args, identity?.id ?? null);
      if (state.error) throw state.error;
      return { rows: [{ v: state.rows ?? [] }] };
    },
  }),
}));
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: async (...args: unknown[]) => {
    state.rateLimit(...args);
    return state.allowed;
  },
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/campaign-banner/font', () => ({ bannerFontBase64: async () => undefined }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) => {
    const messages = (locale === 'nl' ? nl : pl) as unknown as Record<string, Record<string, string>>;
    return (key: string, values?: Record<string, string>) =>
      (messages[namespace]?.[key] ?? key).replace(/\{(\w+)\}/g, (_, name: string) => values?.[name] ?? '');
  },
}));

const { GET } = await import('@/app/api/employer/jobs/[id]/banner/route');

const JOB_ID = '5c3a1f0e-1111-4000-8000-000000000001';
const ROW = {
  slug: 'kierowca-c-e-gandawa',
  title: 'Kierowca C+E',
  company_name: 'Transport Gent BV',
  city: 'Gandawa',
  region: 'Flandria',
  contract_type: 'permanent',
  accommodation: false,
  salary_min: 2900,
  salary_max: 3300,
  currency: 'EUR',
  salary_period: 'month',
};

function call(query = 'format=1200x300&locale=pl', id = JOB_ID) {
  return GET(new Request(`http://localhost/api/employer/jobs/${id}/banner?${query}`), {
    params: Promise.resolve({ id }),
  });
}

function expectPrivate(response: Response) {
  expect(response.headers.get('cache-control')).toBe('private, no-store');
  expect(response.headers.get('x-robots-tag')).toMatch(/noindex/);
}

beforeEach(() => {
  state.configured = true;
  state.user = { id: 'u-1' };
  state.allowed = true;
  state.rows = [ROW];
  state.error = null;
  state.rpc.mockClear();
  state.rateLimit.mockClear();
});

describe('GET /api/employer/jobs/[id]/banner', () => {
  it('zwraca SVG oferty z trasy zaufanej (RPC panelu) z nagłówkami prywatności', async () => {
    const response = await call('format=300x250&locale=nl&download=1');
    expect(response.status).toBe(200);
    expect(state.rpc).toHaveBeenCalledWith('get_managed_campaign_job', { p_job_id: JOB_ID, p_locale: 'nl' }, 'u-1');
    expect(response.headers.get('content-type')).toBe('image/svg+xml; charset=utf-8');
    expect(response.headers.get('content-security-policy')).toMatch(/default-src 'none'.*sandbox/);
    expect(response.headers.get('content-disposition')).toBe(
      'attachment; filename="pracujbe-kierowca-c-e-gandawa-nl-300x250.svg"',
    );
    expectPrivate(response);
    const svg = await response.text();
    expect(svg).toContain('viewBox="0 0 300 250"');
    expect(svg).toContain('Kierowca C+E');
    expect(svg).toContain(nl.campaignBanner.cta);
    expect(svg).toContain('https://pracuj.be/nl/oferty-pracy/kierowca-c-e-gandawa');
    expect(state.rateLimit).toHaveBeenCalledWith('campaign-banner', expect.objectContaining({ identifier: 'u-1', perIp: false }));
  });

  it('podgląd bez download=1 jest inline', async () => {
    const response = await call();
    expect(response.headers.get('content-disposition')).toMatch(/^inline;/);
  });

  it('brak wiersza z bazy (nieaktywna, wygasła, demo, cudza, nieistniejąca) = ten sam 404 bez treści', async () => {
    state.rows = [];
    const response = await call();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
    expectPrivate(response);
    // Wiersz bez wymaganych pól też nie daje baneru.
    state.rows = [{ ...ROW, company_name: '' }];
    expect((await call()).status).toBe(404);
  });

  it('bez PII: pola spoza kontraktu nie trafiają do SVG', async () => {
    state.rows = [{ ...ROW, email: 'rekrutacja@transport.be', phone: '+32 9 123 45 67', id: JOB_ID }];
    const svg = await (await call('format=300x600&locale=pl')).text();
    expect(svg).not.toMatch(/rekrutacja@|\+32|5c3a1f0e/);
  });

  it('niezalogowany = 401, limit przekroczony = 429, tryb demo = 404 (bez danych demonstracyjnych)', async () => {
    state.user = null;
    expect((await call()).status).toBe(401);
    expect(state.rpc).not.toHaveBeenCalled();

    state.user = { id: 'u-1' };
    state.allowed = false;
    expect((await call()).status).toBe(429);
    expect(state.rpc).not.toHaveBeenCalled();

    state.allowed = true;
    state.configured = false;
    expect((await call()).status).toBe(404);
    expect(state.rpc).not.toHaveBeenCalled();
  });

  it('błędne parametry = 400 przed sesją i bazą; błąd bazy = 500', async () => {
    for (const [query, id] of [
      ['format=999x999&locale=pl', JOB_ID],
      ['format=1200x300&locale=de', JOB_ID],
      ['format=1200x300&locale=pl', 'not-a-uuid'],
    ] as const) {
      expect((await call(query, id)).status).toBe(400);
    }
    expect(state.rpc).not.toHaveBeenCalled();
    state.error = Object.assign(new Error('boom'), { code: 'XX000' });
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('');
  });
});
