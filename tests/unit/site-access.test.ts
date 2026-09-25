// @vitest-environment node
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import middleware from '@/middleware';

// next-intl/middleware nie ładuje się w Vitest (ESM `next/server`); bramka działa przed nim.
vi.mock('next-intl/middleware', async () => {
  const { NextResponse } = await import('next/server');
  return { default: () => () => NextResponse.next() };
});
// #584 — domyślnie zachowanie jak bez konfiguracji limitera w teście (przepuszcza), żeby nie
// zmieniać istniejących testów; jeden opisany blok niżej nadpisuje to na `false`.
const checkRateLimit = vi.fn(async (_action: string, _opts?: unknown) => true);
vi.mock('@/lib/rate-limit', () => ({
  checkRateLimit: (action: string, opts?: unknown) => checkRateLimit(action, opts),
}));
import { POST } from '@/app/api/site-access/route';
import {
  SITE_ACCESS_COOKIE,
  constantTimeEqual,
  hasSiteAccess,
  pickGateLocale,
  renderSiteAccessPage,
  siteAccessReturnPath,
  siteAccessToken,
} from '@/lib/site-access';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const PASSWORD = 'tajne-haslo-123';
const ORIGIN = 'https://pracuj.example';

function pageRequest(path: string, init: { cookie?: string; lang?: string } = {}) {
  const headers = new Headers();
  if (init.cookie) headers.set('cookie', init.cookie);
  if (init.lang) headers.set('accept-language', init.lang);
  return new NextRequest(new URL(path, ORIGIN), { headers });
}

function formRequest(fields: Record<string, string>) {
  const body = new URLSearchParams(fields);
  return new Request(`${ORIGIN}/api/site-access`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
}

describe('bramka dostępu — logika', () => {
  it('token to HMAC zależny od hasła, cookie z innym hasłem nie daje dostępu', async () => {
    const token = await siteAccessToken(PASSWORD);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(token).not.toContain(PASSWORD);
    expect(await hasSiteAccess(token, PASSWORD)).toBe(true);
    expect(await hasSiteAccess(await siteAccessToken('inne'), PASSWORD)).toBe(false);
    expect(await hasSiteAccess(undefined, PASSWORD)).toBe(false);
    expect(constantTimeEqual('abc', 'abcd')).toBe(false);
  });

  it('język: prefiks ścieżki, potem Accept-Language, potem domyślny', () => {
    expect(pickGateLocale('/nl/vacatures', 'fr-BE')).toBe('nl');
    expect(pickGateLocale('/', 'fr-BE,fr;q=0.9')).toBe('fr');
    expect(pickGateLocale('/', 'de-DE')).toBe('pl');
    expect(pickGateLocale('/', null)).toBe('pl');
  });

  it('cel powrotu przyjmuje tylko ścieżki z prefiksem języka', () => {
    expect(siteAccessReturnPath('/en/oferty-pracy?q=a', 'en')).toBe('/en/oferty-pracy?q=a');
    expect(siteAccessReturnPath('//evil.example', 'pl')).toBe('/pl');
    expect(siteAccessReturnPath('https://evil.example/pl', 'pl')).toBe('/pl');
    expect(siteAccessReturnPath(null, 'fr')).toBe('/fr');
  });

  it.each([
    ['pl', pl],
    ['nl', nl],
    ['fr', fr],
    ['en', en],
  ] as const)('strona bramki w %s: teksty z messages, noindex, formularz, błąd', (locale, msgs) => {
    const html = renderSiteAccessPage({ locale, next: '/pl/"><script>x</script>', error: true });
    expect(html).toContain(`<html lang="${locale}">`);
    expect(html).toContain(msgs.siteAccess.title);
    expect(html).toContain(msgs.siteAccess.passwordLabel);
    expect(html).toContain(msgs.siteAccess.error);
    expect(html).toContain('name="robots" content="noindex,nofollow"');
    expect(html).toContain('action="/api/site-access"');
    expect(html).toContain('type="password"');
    expect(html).not.toContain('<script>');
    const noError = renderSiteAccessPage({ locale, next: '/pl', error: false });
    expect(noError).not.toContain('role="alert"');

    // #584 — wariant „za dużo prób” pokazuje osobny komunikat, nie „nieprawidłowe hasło”.
    const rateLimited = renderSiteAccessPage({ locale, next: '/pl', error: false, rateLimited: true });
    expect(rateLimited).toContain(msgs.siteAccess.rateLimited);
    expect(rateLimited).not.toContain(msgs.siteAccess.error);
    expect(rateLimited).toContain('role="alert"');
  });
});

describe('bramka dostępu — middleware', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', PASSWORD);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('bez cookie każda strona zwraca formularz hasła (503, noindex) w języku ścieżki', async () => {
    for (const path of ['/', '/pl', '/nl/oferty-pracy', '/en/candidate']) {
      const res = await middleware(pageRequest(path));
      expect(res.status).toBe(503);
      expect(res.headers.get('x-robots-tag')).toContain('noindex');
      expect(res.headers.get('cache-control')).toBe('no-store');
      const html = await res.text();
      expect(html).toContain('name="password"');
    }
    const nlRes = await middleware(pageRequest('/nl/oferty-pracy'));
    expect(await nlRes.text()).toContain(nl.siteAccess.title);
  });

  it('flaga błędu pokazuje komunikat i nie trafia do celu powrotu', async () => {
    const res = await middleware(pageRequest('/pl/oferty-pracy?q=kierowca&pb_access=denied'));
    const html = await res.text();
    expect(html).toContain(pl.siteAccess.error);
    expect(html).toContain('value="/pl/oferty-pracy?q=kierowca"');
  });

  it('z ważnym cookie strona przechodzi dalej; ze starym cookie — nie', async () => {
    const token = await siteAccessToken(PASSWORD);
    const ok = await middleware(pageRequest('/pl', { cookie: `${SITE_ACCESS_COOKIE}=${token}` }));
    expect(ok.status).not.toBe(503);
    // #298: strona może pochodzić z cache ISR, ale przy bramce nie trafia do cache współdzielonego.
    expect(ok.headers.get('cache-control')).toBe('private, no-store');
    const stale = await siteAccessToken('stare-haslo');
    const denied = await middleware(
      pageRequest('/pl', { cookie: `${SITE_ACCESS_COOKIE}=${stale}` }),
    );
    expect(denied.status).toBe(503);
  });

  it('bez SITE_ACCESS_PASSWORD bramka jest wyłączona', async () => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', '');
    const res = await middleware(pageRequest('/pl'));
    expect(res.status).not.toBe(503);
    // Kontrola ujemna (#298): bez bramki middleware nie nadpisuje nagłówka cache strony.
    expect(res.headers.get('cache-control')).toBeNull();
  });
});

describe('bramka dostępu — POST /api/site-access', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', PASSWORD);
    checkRateLimit.mockClear();
    checkRateLimit.mockResolvedValue(true);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('poprawne hasło: cookie httpOnly z HMAC i powrót na żądaną stronę', async () => {
    const res = await POST(
      formRequest({ password: PASSWORD, next: '/nl/oferty-pracy?q=a', locale: 'nl' }),
    );
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get('location')!, ORIGIN).pathname).toBe('/nl/oferty-pracy');
    const cookie = res.headers.get('set-cookie') ?? '';
    expect(cookie).toContain(`${SITE_ACCESS_COOKIE}=${await siteAccessToken(PASSWORD)}`);
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie.toLowerCase()).toContain('secure');
    expect(cookie).not.toContain(PASSWORD);
  });

  it('błędne hasło: brak cookie i powrót z flagą błędu', async () => {
    const res = await POST(formRequest({ password: 'zle', next: '/fr', locale: 'fr' }));
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get('location')!, ORIGIN);
    expect(location.pathname).toBe('/fr');
    expect(location.searchParams.get('pb_access')).toBe('denied');
    expect(res.headers.get('set-cookie')).toBeNull();
  });

  it('przekierowania są względne — za proxy (request.url = adres wewnętrzny) nie wyciekają na localhost', async () => {
    const body = new URLSearchParams({ password: PASSWORD, next: '/pl/oferty-pracy', locale: 'pl' });
    const internal = new Request('https://localhost:8080/api/site-access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-proto': 'https' },
      body,
    });
    const ok = await POST(internal);
    expect(ok.headers.get('location')).toBe('/pl/oferty-pracy');
    expect((ok.headers.get('set-cookie') ?? '').toLowerCase()).toContain('secure');
    const bad = await POST(
      new Request('https://localhost:8080/api/site-access', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ password: 'zle', next: '/pl', locale: 'pl' }),
      }),
    );
    expect(bad.headers.get('location')).toBe('/pl?pb_access=denied');
  });

  it('niebezpieczny cel powrotu zamieniany na stronę główną języka', async () => {
    const res = await POST(
      formRequest({ password: PASSWORD, next: '//evil.example/x', locale: 'en' }),
    );
    const location = new URL(res.headers.get('location')!, ORIGIN);
    expect(location.origin).toBe(ORIGIN);
    expect(location.pathname).toBe('/en');
  });
});

describe('bramka dostępu — limit prób (#584)', () => {
  beforeEach(() => {
    vi.stubEnv('SITE_ACCESS_PASSWORD', PASSWORD);
    checkRateLimit.mockClear();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('przekroczony limit → 429 + Retry-After, BEZ porównania hasła (nawet poprawnego)', async () => {
    checkRateLimit.mockResolvedValue(false);
    const res = await POST(formRequest({ password: PASSWORD, next: '/pl', locale: 'pl' }));
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe(String(15 * 60));
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('x-robots-tag')).toContain('noindex');
    // Bez cookie dostępu — limit blokuje PRZED porównaniem hasła, nawet gdy było poprawne.
    expect(res.headers.get('set-cookie')).toBeNull();
    const html = await res.text();
    expect(html).toContain(pl.siteAccess.rateLimited);
    expect(html).not.toContain(pl.siteAccess.error);
  });

  it('limiter wołany z kluczem `site-access` per adres, PRZED odczytem/porównaniem hasła', async () => {
    checkRateLimit.mockResolvedValue(true);
    await POST(formRequest({ password: PASSWORD, next: '/pl', locale: 'pl' }));
    expect(checkRateLimit).toHaveBeenCalledWith('site-access', expect.objectContaining({ max: 20, windowSeconds: 15 * 60 }));
  });

  it('kontrola ujemna: w limicie — zwykły przepływ (poprawne/błędne hasło) bez zmian', async () => {
    checkRateLimit.mockResolvedValue(true);
    const ok = await POST(formRequest({ password: PASSWORD, next: '/pl', locale: 'pl' }));
    expect(ok.status).toBe(303);
    expect(ok.headers.get('set-cookie')).not.toBeNull();

    const bad = await POST(formRequest({ password: 'zle', next: '/pl', locale: 'pl' }));
    expect(bad.status).toBe(303);
    expect(new URL(bad.headers.get('location')!, ORIGIN).searchParams.get('pb_access')).toBe('denied');
  });
});
