// @vitest-environment node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import config from '../../next.config.mjs';
import {
  HEALTH_TOKEN_HEADER,
  HSTS_MIN_MAX_AGE,
  LOCALES,
  LOCALIZED_PAGES,
  SITEMAP_STATIC_ID,
  buildChecks,
  readConfig,
  runSmoke,
  securityHeaderProblems,
  versionMatchesSha,
} from '../../scripts/railway/prod-smoke.mjs';
import { HEALTH_TOKEN_HEADER as APP_HEALTH_TOKEN_HEADER } from '@/lib/ops/health-token';

const PASSWORD = 'smoke-test-password-value';
const COOKIE_VALUE = 'cookie-token-value-0123456789';

type Fault = { status?: number; hang?: boolean; health?: string; dropHeader?: string };

/** Nagłówki stron jak `next.config.mjs` poza produkcją (wartości skrócone do sprawdzanych). */
const DEMO_PAGE_HEADERS: Record<string, string> = {
  'content-security-policy': "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'strict-origin-when-cross-origin',
  'x-robots-tag': 'noindex, nofollow, noarchive',
};
const HEALTH_SECRET = 'health-secret-value-0123456789abcdef';

/** Atrapa serwisu: bramka hasła jak `src/lib/site-access.ts` + trasy aplikacji. */
function startFakeSite(options: { gate?: boolean; faults?: Record<string, Fault>; version?: string } = {}) {
  const gate = options.gate ?? true;
  const faults = options.faults ?? {};
  const requests: { method: string; path: string; body: string; healthToken?: string }[] = [];
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      const path = new URL(req.url ?? '/', 'http://x').pathname;
      const token = req.headers[HEALTH_TOKEN_HEADER];
      requests.push({ method: req.method ?? '', path, body, healthToken: typeof token === 'string' ? token : undefined });
      if (req.method === 'POST' && path === '/api/site-access') {
        const ok = new URLSearchParams(body).get('password') === PASSWORD;
        res.writeHead(303, ok
          ? { location: '/pl', 'set-cookie': `pb_site_access=${COOKIE_VALUE}; Path=/; HttpOnly` }
          : { location: '/pl?pb_access=denied' });
        return res.end();
      }
      const fault = faults[path];
      if (fault?.hang) return; // brak odpowiedzi → timeout klienta
      if (fault?.status) {
        res.writeHead(fault.status, { 'content-type': 'text/plain' });
        return res.end('fault');
      }
      if (path === '/api/health') {
        const status = fault?.health ?? 'ok';
        res.writeHead(status === 'ok' ? 200 : 503, { 'content-type': 'application/json' });
        // Jak `/api/health` w produkcji: wersja tylko z sekretem monitoringu.
        const detailed = options.version !== undefined && req.headers[HEALTH_TOKEN_HEADER] === HEALTH_SECRET;
        return res.end(JSON.stringify(detailed ? { status, version: options.version } : { status }));
      }
      if (path === '/robots.txt' || path === '/sitemap/0.xml') {
        res.writeHead(200);
        return res.end('ok');
      }
      // Jak Next.js przy `generateSitemaps()` (#599): pojedynczego `/sitemap.xml` nie ma.
      if (path === '/sitemap.xml') {
        res.writeHead(404);
        return res.end('not found');
      }
      const gated = gate && !(req.headers.cookie ?? '').includes(`pb_site_access=${COOKIE_VALUE}`);
      if (gated) {
        res.writeHead(503, { 'content-type': 'text/html' });
        return res.end('<form method="post" action="/api/site-access"></form>');
      }
      if (path === '/') {
        res.writeHead(307, { location: '/pl' });
        return res.end();
      }
      const pageHeaders: Record<string, string> = { 'content-type': 'text/html', ...DEMO_PAGE_HEADERS };
      if (fault?.dropHeader) delete pageHeaders[fault.dropHeader];
      res.writeHead(200, pageHeaders);
      res.end('<html></html>');
    });
  });
  return new Promise<{ url: string; requests: typeof requests; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        requests,
        close: () => new Promise((done) => {
          server.closeAllConnections();
          server.close(() => done());
        }),
      });
    });
  });
}

const logger = () => ({ log: vi.fn(), error: vi.fn() });
const output = (logs: ReturnType<typeof logger>) => JSON.stringify([...logs.log.mock.calls, ...logs.error.mock.calls]);

let site: Awaited<ReturnType<typeof startFakeSite>> | undefined;
afterEach(async () => {
  await site?.close();
  site = undefined;
});

describe('prod smoke — lista sprawdzeń', () => {
  it('obejmuje health, robots, sitemap, / i trasy publiczne oraz auth w 4 językach', () => {
    const paths = buildChecks().map((check) => check.path);
    expect(LOCALES).toEqual(['pl', 'nl', 'fr', 'en']);
    for (const path of ['/api/health', '/', '/robots.txt', '/sitemap/0.xml']) expect(paths).toContain(path);
    expect(paths).not.toContain('/sitemap.xml');
    for (const locale of LOCALES) {
      for (const page of ['', '/oferty-pracy', '/logowanie', '/rejestracja', '/reset-hasla']) {
        expect(paths).toContain(`/${locale}${page}`);
      }
    }
    expect(paths).toHaveLength(4 + LOCALES.length * LOCALIZED_PAGES.length);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('sitemap: ta sama ścieżka co indeks z `sitemap.ts`/`robots.ts` (#599)', () => {
    // `generateSitemaps()` → Next.js serwuje `/sitemap/<id>.xml`, a `/sitemap.xml` = 404
    // (produkcja 26.09.2026). Jeśli ktoś wróci do jednego pliku, ten test wymusi zmianę smoke.
    const sitemap = readFileSync('src/app/sitemap.ts', 'utf8');
    const robots = readFileSync('src/app/robots.ts', 'utf8');
    expect(sitemap).toMatch(/export async function generateSitemaps\(/);
    expect(robots).toContain('/sitemap/${id}.xml');
    expect(sitemap).toContain(`id \`${SITEMAP_STATIC_ID}\` = strony statyczne`);
    expect(buildChecks().map((check) => check.path)).toContain(`/sitemap/${SITEMAP_STATIC_ID}.xml`);
  });

  it('nie sprawdza paneli ani tras zmieniających dane', () => {
    for (const path of buildChecks().map((check) => check.path)) {
      expect(path).not.toMatch(/\/(candidate|employer|admin)(\/|$)|\/api\/(?!health$)/);
    }
  });
});

describe('prod smoke — konfiguracja', () => {
  it.each([
    { PROD_SMOKE_BASE_URL: 'http://pracuj.be' },
    { PROD_SMOKE_BASE_URL: 'https://user:pass@pracuj.be' },
    { PROD_SMOKE_BASE_URL: 'https://pracuj.be/pl' },
    { PROD_SMOKE_BASE_URL: 'https://pracuj.be/?x=1' },
    { PROD_SMOKE_BASE_URL: 'https://pracuj.be/#' },
    { PROD_SMOKE_BASE_URL: 'not a url' },
    { PROD_SMOKE_TIMEOUT_MS: '0' },
    { PROD_SMOKE_TIMEOUT_MS: 'abc' },
    { PROD_SMOKE_EXPECT_MODE: 'staging' },
    { PROD_SMOKE_EXPECT_SHA: 'xyz1234' },
    { PROD_SMOKE_EXPECT_SHA: 'abc12' },
  ])('odrzuca %j bez żadnego żądania (kod 2)', async (env) => {
    const fetchImpl = vi.fn();
    expect(await runSmoke({ env, fetchImpl, logger: logger() })).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('domyślnie https://pracuj.be, http tylko dla localhost', () => {
    expect(readConfig({})?.baseUrl.origin).toBe('https://pracuj.be');
    expect(readConfig({ PROD_SMOKE_BASE_URL: 'http://localhost:3000' })?.baseUrl.origin).toBe('http://localhost:3000');
  });
});

describe('prod smoke — atrapa serwera', () => {
  it('loguje się przez bramkę, sprawdza wszystkie trasy i zwraca 0 bez ujawniania hasła ani cookie', async () => {
    site = await startFakeSite();
    const logs = logger();
    expect(await runSmoke({ env: { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD }, logger: logs })).toBe(0);
    const login = site.requests.filter((request) => request.method === 'POST');
    expect(login).toHaveLength(1);
    expect(login[0]?.path).toBe('/api/site-access');
    expect(site.requests.filter((request) => request.method === 'GET')).toHaveLength(buildChecks().length);
    expect(site.requests.every((request) => !request.path.includes(PASSWORD))).toBe(true);
    const text = output(logs);
    expect(text).not.toContain(PASSWORD);
    expect(text).not.toContain(COOKIE_VALUE);
    expect(logs.error).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: brak pliku sitemap ze stronami statycznymi = błąd', async () => {
    site = await startFakeSite({ faults: { '/sitemap/0.xml': { status: 404 } } });
    const logs = logger();
    expect(await runSmoke({ env: { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD }, logger: logs })).toBe(1);
    expect(output(logs)).toContain('/sitemap/0.xml');
  });

  it('bez bramki działa bez hasła', async () => {
    site = await startFakeSite({ gate: false });
    expect(await runSmoke({ env: { PROD_SMOKE_BASE_URL: site.url }, logger: logger() })).toBe(0);
  });

  it('kontrola ujemna: aktywna bramka bez SITE_ACCESS_PASSWORD = błąd z podpowiedzią', async () => {
    site = await startFakeSite();
    const logs = logger();
    expect(await runSmoke({ env: { PROD_SMOKE_BASE_URL: site.url }, logger: logs })).toBe(1);
    expect(output(logs)).toContain('ustaw SITE_ACCESS_PASSWORD');
  });

  it('kontrola ujemna: złe hasło kończy test przed sprawdzaniem tras', async () => {
    site = await startFakeSite();
    const logs = logger();
    expect(await runSmoke({ env: { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: 'wrong-password-x' }, logger: logs })).toBe(1);
    expect(site.requests.filter((request) => request.method === 'GET')).toHaveLength(0);
    expect(output(logs)).not.toContain('wrong-password-x');
  });

  it.each([
    ['/nl/oferty-pracy', { status: 500 }, 'błąd serwera 5xx'],
    ['/fr/logowanie', { status: 502 }, 'błąd serwera 5xx'],
    ['/en/rejestracja', { status: 404 }, 'oczekiwano 200'],
    ['/api/health', { health: 'unavailable' }, 'błąd serwera 5xx'],
    ['/pl/pomoc', { hang: true }, 'przekroczono czas'],
  ] as const)('kontrola ujemna: %s (%j) → kod 1', async (path, fault, reason) => {
    site = await startFakeSite({ faults: { [path]: fault } });
    const logs = logger();
    // Krótki limit czasu tylko dla zawieszonej trasy. Wspólne 300 ms dla wszystkich ~26 żądań
    // pod obciążeniem maszyny zamieniało zwykłą (wolną) odpowiedź atrapy w „przekroczono czas”
    // i psuło asercję „1 z N”; 5xx/404 nie potrzebują limitu, więc dostają zapas.
    const timeoutMs = 'hang' in fault ? '500' : '4000';
    const env = { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD, PROD_SMOKE_TIMEOUT_MS: timeoutMs };
    expect(await runSmoke({ env, logger: logs })).toBe(1);
    const errors = JSON.stringify(logs.error.mock.calls);
    expect(errors).toContain(path);
    expect(errors).toContain(reason);
    expect(errors).toContain('1 z');
  });

  it('health 200 bez status "ok" jest błędem', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => new Response('{"status":"degraded"}', { status: 200 }));
    const logs = logger();
    const checks = [{ path: '/api/health', expect: [200], health: true }];
    expect(await runSmoke({ env: {}, fetchImpl, logger: logs, checks })).toBe(1);
    expect(JSON.stringify(logs.error.mock.calls)).toContain('health bez status');
  });

  it('przekierowanie / poza domenę albo bez języka jest błędem', async () => {
    const checks = [{ path: '/', expect: [307, 308], redirectToLocale: true }];
    for (const location of ['https://evil.example/pl', '/de', '/']) {
      const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 307, headers: { location } }));
      expect(await runSmoke({ env: {}, fetchImpl, logger: logger(), checks })).toBe(1);
    }
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 307, headers: { location: 'https://pracuj.be/nl' } }));
    expect(await runSmoke({ env: {}, fetchImpl, logger: logger(), checks })).toBe(0);
  });
});

async function configHeaders(env: Record<string, string>): Promise<Headers> {
  vi.stubEnv('NODE_ENV', 'production');
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const rules = await config.headers!();
  const rule = rules.find((entry) => entry.source === '/:path*')!;
  return new Headers(rule.headers.map((header) => [header.key, header.value] as [string, string]));
}

describe('prod smoke — nagłówki bezpieczeństwa (LAUNCH_CHECKLIST §12)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('nagłówki z next.config.mjs w produkcji spełniają oczekiwania trybu production', async () => {
    const headers = await configHeaders({ APP_MODE: 'production', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    expect(securityHeaderProblems(headers, { https: true, expectMode: 'production' })).toEqual([]);
    // Kontrola ujemna: te same nagłówki nie przejdą jako „demo” (brak noindex).
    expect(securityHeaderProblems(headers, { https: true, expectMode: 'demo' })).toContain('brak X-Robots-Tag: noindex poza produkcją');
  });

  it('nagłówki z next.config.mjs poza produkcją spełniają tryb demo, a nie production', async () => {
    const headers = await configHeaders({ APP_MODE: 'demo', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    expect(securityHeaderProblems(headers, { https: true, expectMode: 'demo' })).toEqual([]);
    expect(securityHeaderProblems(headers, { https: true })).toEqual([]);
    const problems = securityHeaderProblems(headers, { https: true, expectMode: 'production' });
    expect(problems).toContain(`brak HSTS z max-age ≥ ${HSTS_MIN_MAX_AGE}`);
    expect(problems).toContain('X-Robots-Tag: noindex w trybie produkcyjnym');
  });

  it('smoke wysyła sekret w tym samym nagłówku, który czyta /api/health', () => {
    expect(HEALTH_TOKEN_HEADER).toBe(APP_HEALTH_TOKEN_HEADER);
  });

  it.each([
    ['content-security-policy', 'brak Content-Security-Policy'],
    ['x-content-type-options', 'nosniff'],
    ['x-frame-options', 'DENY'],
    ['referrer-policy', 'Referrer-Policy'],
  ])('kontrola ujemna: brak %s = problem', async (name, message) => {
    const headers = await configHeaders({ APP_MODE: 'production', NEXT_PUBLIC_SITE_URL: 'https://pracuj.be' });
    headers.delete(name);
    expect(securityHeaderProblems(headers, { https: true, expectMode: 'production' }).join(' ')).toContain(message);
  });

  it('kontrola ujemna: osłabiona CSP, ujawniający Referrer-Policy i krótki HSTS', () => {
    const headers = new Headers({
      'content-security-policy': "default-src 'self'; frame-ancestors *",
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'SAMEORIGIN',
      'referrer-policy': 'unsafe-url',
      'strict-transport-security': 'max-age=300',
    });
    const problems = securityHeaderProblems(headers, { https: true, expectMode: 'production' });
    expect(problems).toEqual([
      "CSP bez frame-ancestors 'none'",
      "CSP bez object-src 'none'",
      "CSP bez base-uri 'self'",
      'brak X-Frame-Options: DENY',
      'Referrer-Policy nieustawiona albo ujawniająca ścieżkę',
      `brak HSTS z max-age ≥ ${HSTS_MIN_MAX_AGE}`,
    ]);
    // http://localhost (testy lokalne): HSTS nie jest wymagany.
    expect(securityHeaderProblems(headers, { https: false, expectMode: 'production' })).not.toContain(`brak HSTS z max-age ≥ ${HSTS_MIN_MAX_AGE}`);
  });

  it('atrapa: strona bez X-Frame-Options = kod 1 ze ścieżką', async () => {
    site = await startFakeSite({ faults: { '/fr/kontakt': { dropHeader: 'x-frame-options' } } });
    const logs = logger();
    expect(await runSmoke({ env: { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD }, logger: logs })).toBe(1);
    const errors = JSON.stringify(logs.error.mock.calls);
    expect(errors).toContain('/fr/kontakt');
    expect(errors).toContain('X-Frame-Options');
    expect(errors).toContain('1 z');
  });

  it('atrapa: tryb demo przechodzi, tryb production wykrywa noindex na każdej stronie', async () => {
    site = await startFakeSite();
    const env = { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD };
    expect(await runSmoke({ env: { ...env, PROD_SMOKE_EXPECT_MODE: 'demo' }, logger: logger() })).toBe(0);
    const logs = logger();
    expect(await runSmoke({ env: { ...env, PROD_SMOKE_EXPECT_MODE: 'production' }, logger: logs })).toBe(1);
    expect(JSON.stringify(logs.error.mock.calls)).toContain(`${LOCALES.length * LOCALIZED_PAGES.length} z`);
  });
});

describe('prod smoke — wdrożony SHA (LAUNCH_CHECKLIST §11)', () => {
  it('porównuje skrót z version po wspólnym prefiksie', () => {
    expect(versionMatchesSha('0.20260927.123+d5a586f2', 'd5a586f2f5e9f47835a64d3916ff4b5f9f2330b9')).toBe(true);
    expect(versionMatchesSha('1.0.0+d5a586f2', 'd5a586f')).toBe(true);
    expect(versionMatchesSha('0.20260927.123+d5a586f2', '6e9fbc24f')).toBe(false);
    expect(versionMatchesSha('0.20260927.123', 'd5a586f2')).toBe(false);
    expect(versionMatchesSha(null, 'd5a586f2')).toBe(false);
  });

  it('z sekretem monitoringu: zgodny SHA = 0, sekret tylko w nagłówku health, nigdy w logach', async () => {
    site = await startFakeSite({ version: '0.20260927.5+d5a586f2' });
    const logs = logger();
    const env = {
      PROD_SMOKE_BASE_URL: site.url,
      SITE_ACCESS_PASSWORD: PASSWORD,
      PROD_SMOKE_EXPECT_SHA: 'D5A586F2F5E9F47835A64D3916FF4B5F9F2330B9',
      HEALTH_CHECK_SECRET: HEALTH_SECRET,
    };
    expect(await runSmoke({ env, logger: logs })).toBe(0);
    const withToken = site.requests.filter((request) => request.healthToken !== undefined);
    expect(withToken.map((request) => request.path)).toEqual(['/api/health']);
    expect(site.requests.every((request) => !request.path.includes(HEALTH_SECRET))).toBe(true);
    expect(output(logs)).not.toContain(HEALTH_SECRET);
  });

  it('kontrola ujemna: inny SHA = kod 1 z obiema wartościami', async () => {
    site = await startFakeSite({ version: '0.20260927.5+6e9fbc24' });
    const logs = logger();
    const env = { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD, PROD_SMOKE_EXPECT_SHA: 'd5a586f2', HEALTH_CHECK_SECRET: HEALTH_SECRET };
    expect(await runSmoke({ env, logger: logs })).toBe(1);
    const errors = JSON.stringify(logs.error.mock.calls);
    expect(errors).toContain('6e9fbc24');
    expect(errors).toContain('d5a586f2');
  });

  it('kontrola ujemna: bez sekretu produkcyjny health nie ma wersji — błąd z podpowiedzią', async () => {
    site = await startFakeSite({ version: '0.20260927.5+d5a586f2' });
    const logs = logger();
    const env = { PROD_SMOKE_BASE_URL: site.url, SITE_ACCESS_PASSWORD: PASSWORD, PROD_SMOKE_EXPECT_SHA: 'd5a586f2' };
    expect(await runSmoke({ env, logger: logs })).toBe(1);
    expect(JSON.stringify(logs.error.mock.calls)).toContain('HEALTH_CHECK_SECRET');
  });
});
