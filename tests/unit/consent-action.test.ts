import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { recordConsent } from '@/lib/actions/consent';
import { CONSENT_CATEGORIES } from '@/lib/consent';
import * as portal from '@/lib/db/portal';
import { checkRateLimit } from '@/lib/rate-limit';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #349 — dowód zgody (RODO art. 7): `recordConsent` przekazuje do RPC `record_consent`
 * kategorie, znormalizowane źródło, visitor_id, IP klienta i user-agent. Każdy błąd kończy się
 * `{ ok: false }` bez wyjątku do UI (Invariant #8).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
// #588: `X-Forwarded-For` jest dopisywany przez KLIENTA — wartość mutowalna per test, żeby
// odróżnić zaufany `X-Real-IP` (musi trafić do receiptu) od sfałszowanego XFF (musi zostać pominięty).
const requestHeaders = vi.hoisted(() => ({
  current: new Headers({ 'x-real-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 test' }),
}));
vi.mock('next/headers', () => ({
  headers: async () => requestHeaders.current,
  cookies: async () => ({
    get: (name: string) => (name === 'pracujbe_visitor' ? { value: 'visitor-1' } : undefined),
  }),
}));

const CATEGORIES = { necessary: true, preferences: false, analytics: true };
const USER = '11111111-1111-4111-8111-111111111111';

/** Argumenty wysłane do RPC; jsonb (`p_categories`) wraca jako obiekt. */
function sentArgs(index = 0): Record<string, unknown> {
  const args = { ...fakeDb.callsTo('record_consent')[index]!.args };
  args['p_categories'] = JSON.parse(String(args['p_categories']));
  return args;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  fakeDb.rpc('record_consent', null);
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  requestHeaders.current = new Headers({ 'x-real-ip': '203.0.113.7', 'user-agent': 'Mozilla/5.0 test' });
});

describe('recordConsent', () => {
  it('wysyła kategorie, źródło, visitor_id, zaufany IP (X-Real-IP), user-agent i wersję', async () => {
    expect(await recordConsent(CATEGORIES, 'cookie_settings', '2026-01')).toEqual({ ok: true });
    expect(sentArgs()).toEqual({
      p_categories: CATEGORIES,
      p_source: 'cookie_settings',
      p_visitor_id: 'visitor-1',
      p_ip: '203.0.113.7',
      p_user_agent: 'Mozilla/5.0 test',
      p_version: '2026-01',
    });
    // Zalogowany: transakcja sesji (auth.uid() = konto), jsonb jako JSON.
    expect(fakeDb.callsTo('record_consent')[0]!.as).toBe(USER);
  });

  it('bez wersji (wołający nie ją podał) → p_version null, RPC dobiera bieżącą', async () => {
    await recordConsent(CATEGORIES, 'cookie_banner');
    expect(sentArgs().p_version).toBeNull();
  });

  it('kontrola ujemna (#588): sfałszowany X-Forwarded-For nie zastępuje brakującego X-Real-IP', async () => {
    requestHeaders.current = new Headers({
      'x-forwarded-for': '198.51.100.66',
      'user-agent': 'Mozilla/5.0 test',
    });
    expect(await recordConsent(CATEGORIES, 'cookie_settings')).toEqual({ ok: true });
    expect(sentArgs().p_ip).toBeNull();
  });

  it('X-Forwarded-For obok zaufanego X-Real-IP jest ignorowany (#588)', async () => {
    requestHeaders.current = new Headers({
      'x-real-ip': '203.0.113.7',
      'x-forwarded-for': '198.51.100.66',
      'user-agent': 'Mozilla/5.0 test',
    });
    expect(await recordConsent(CATEGORIES, 'cookie_settings')).toEqual({ ok: true });
    expect(sentArgs().p_ip).toBe('203.0.113.7');
  });

  it('gość: zapis jako anon (bez konta), tak samo jak z banera przed logowaniem', async () => {
    fakeSession.identity = null;
    expect(await recordConsent(CATEGORIES, 'cookie_banner')).toEqual({ ok: true });
    expect(fakeDb.callsTo('record_consent')[0]!.as).toBeNull();
  });

  it('klucz spoza kategorii (marketing ze starego klienta, #570) nie trafia do RPC', async () => {
    const legacy = { ...CATEGORIES, marketing: true } as unknown as typeof CATEGORIES;
    await recordConsent(legacy, 'cookie_banner');
    expect(sentArgs().p_categories).toEqual(CATEGORIES);
  });

  it('nieznane źródło → cookie_banner (nie zapisujemy dowolnego tekstu klienta)', async () => {
    await recordConsent(CATEGORIES, '<script>');
    expect(sentArgs().p_source).toBe('cookie_banner');
  });

  it('błąd RPC → ok:false', async () => {
    fakeDb.rpc('record_consent', () => {
      throw pgError('42501', 'permission denied for function record_consent');
    });
    expect(await recordConsent(CATEGORIES, 'cookie_banner')).toEqual({ ok: false });
  });

  it('wyjątek warstwy danych → ok:false bez rzucania do UI', async () => {
    const spy = vi.spyOn(portal, 'withPortalTransaction').mockRejectedValueOnce(new Error('ECONNREFUSED 10.0.0.1:5432'));
    await expect(recordConsent(CATEGORIES, 'cookie_banner')).resolves.toEqual({ ok: false });
    spy.mockRestore();
  });

  it('limit przekroczony albo tryb demo → ok:false bez RPC', async () => {
    vi.mocked(checkRateLimit).mockResolvedValueOnce(false);
    expect(await recordConsent(CATEGORIES, 'footer')).toEqual({ ok: false });
    fakeSession.configured = false;
    expect(await recordConsent(CATEGORIES, 'footer')).toEqual({ ok: false });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

/** Parametry najnowszej definicji `public.record_consent` w migracjach (kolejność wg prefiksu). */
function recordConsentParams(): string[] {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  let params: string[] | null = null;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(dir, file), 'utf-8');
    const re = /create\s+or\s+replace\s+function\s+public\.record_consent\s*\(([\s\S]*?)\)\s*returns/gi;
    for (const match of sql.matchAll(re)) {
      params = match[1]!
        .split(',')
        .map((p) => p.trim().split(/\s+/)[0]!)
        .filter(Boolean);
    }
  }
  if (!params) throw new Error('brak definicji record_consent w supabase/migrations');
  return params;
}

describe('recordConsent ↔ RPC record_consent (kontrakt z migracją)', () => {
  it('wysyła dokładnie parametry z najnowszej definicji funkcji w bazie', async () => {
    await recordConsent(CATEGORIES, 'cookie_banner');
    const sent = Object.keys(fakeDb.callsTo('record_consent')[0]!.args).sort();
    expect(sent).toEqual(recordConsentParams().sort());
  });
});

/** Lista kategorii (`cats text[] := array[...]`) w najnowszej definicji `record_consent`. */
function recordConsentCategories(files?: string[]): string[] {
  const dir = join(process.cwd(), 'supabase', 'migrations');
  let cats: string[] | null = null;
  const names = files ?? readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of names) {
    const sql = readFileSync(join(dir, file), 'utf-8');
    const re = /create\s+or\s+replace\s+function\s+public\.record_consent[\s\S]*?cats\s+text\[\]\s*:=\s*array\[([^\]]*)\]/gi;
    for (const match of sql.matchAll(re)) {
      cats = [...match[1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
    }
  }
  if (!cats) throw new Error('brak listy kategorii record_consent w supabase/migrations');
  return cats;
}

describe('kategorie logu zgód = kategorie banera (#570)', () => {
  it('najnowsze record_consent zapisuje dokładnie CONSENT_CATEGORIES (bez marketing)', () => {
    expect(recordConsentCategories()).toEqual([...CONSENT_CATEGORIES]);
    expect(recordConsentCategories()).not.toContain('marketing');
  });

  it('kontrola ujemna: definicja z 0043 (z marketing) nie przechodzi porównania', () => {
    expect(recordConsentCategories(['0043_consent_receipt.sql'])).not.toEqual([...CONSENT_CATEGORIES]);
  });
});
