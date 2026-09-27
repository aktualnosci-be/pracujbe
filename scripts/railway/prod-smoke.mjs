import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Smoke test produkcji (#16, #18) — uruchamiany ręcznie przez operatora, POZA CI.
 *
 * Sprawdza trasy publiczne i auth w czterech językach, `/`, `/robots.txt`, `/sitemap/0.xml`
 * oraz `/api/health`: oczekiwany kod odpowiedzi, brak 5xx, limit czasu każdego żądania.
 * Tylko GET na stronach, które nie zmieniają danych — nie zakłada kont, nie aplikuje,
 * nie wysyła e-maili (testy niszczące dane wyłącznie w izolowanej bazie, #16).
 *
 * Partie sitemap ofert (#689): `src/app/sitemap.ts` dzieli katalog na `id` 0 (strony statyczne,
 * sprawdzany zawsze) i `1..N` (oferty, `generateSitemaps()`), a `src/app/robots.ts` wskazuje
 * KAŻDY plik osobną linią `Sitemap:`. Statyczna lista sprawdzeń zna tylko `id=0` — po
 * odczytaniu `/robots.txt` skrypt DOPISUJE sprawdzenie dla każdej partii ofert, której
 * jeszcze nie ma na liście, więc awaria generowania sitemap ofert (zapytanie, paginacja,
 * tłumaczenia) nie umyka smoke testowi mimo zielonego `id=0`. Katalog bez partii ofert
 * (środowisko bez ofert) = bez dodatkowych sprawdzeń, jak dotąd.
 *
 * Bramka hasła (`SITE_ACCESS_PASSWORD`, `src/lib/site-access.ts`): jeśli zmienna jest
 * ustawiona w środowisku operatora, skrypt loguje się przez `POST /api/site-access` i używa
 * wydanego cookie. Hasła i cookie nie wypisujemy nigdy; hasło nie trafia do adresu URL
 * i jest wysyłane wyłącznie przez HTTPS (http tylko dla localhost — testy lokalne).
 *
 * Nagłówki bezpieczeństwa (LAUNCH_CHECKLIST §12): każda strona 200 musi mieć nagłówki
 * z `next.config.mjs` — CSP z `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`,
 * `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`. Tryb
 * (`PROD_SMOKE_EXPECT_MODE`, opcjonalnie): `production` = HSTS (≥ 1 rok, tylko https) i brak
 * nagłówka `X-Robots-Tag: noindex`; `demo` = `X-Robots-Tag: noindex` na każdej stronie.
 * Bez zmiennej tryb nie jest sprawdzany (HSTS może dokładać też Cloudflare).
 *
 * Wdrożony SHA (LAUNCH_CHECKLIST §11): `PROD_SMOKE_EXPECT_SHA` (7–40 znaków hex) musi być
 * zgodny z `+SHA` w polu `version` z `/api/health`. W trybie produkcyjnym wersję widać tylko
 * ze sekretem monitoringu — skrypt wysyła `HEALTH_CHECK_SECRET` w nagłówku `x-health-token`
 * (nigdy w adresie, nigdy w logach).
 *
 * Zmienne: PROD_SMOKE_BASE_URL (domyślnie https://pracuj.be), SITE_ACCESS_PASSWORD
 * (opcjonalnie), PROD_SMOKE_TIMEOUT_MS (domyślnie 15000), PROD_SMOKE_EXPECT_MODE
 * (`production` | `demo`, opcjonalnie), PROD_SMOKE_EXPECT_SHA (opcjonalnie),
 * HEALTH_CHECK_SECRET (opcjonalnie).
 * Wyjście: 0 = wszystko zgodne, 1 = co najmniej jeden błąd, 2 = zła konfiguracja.
 *
 * Użycie: `SITE_ACCESS_PASSWORD=… node scripts/railway/prod-smoke.mjs`
 * (w powłoce wczytaj hasło z menedżera haseł, nie wpisuj go w historię poleceń).
 */

export const LOCALES = ['pl', 'nl', 'fr', 'en'];

/** Strony publiczne i auth bez parametrów — renderują się bez sesji i bez danych w bazie. */
export const LOCALIZED_PAGES = [
  '',
  '/oferty-pracy',
  '/praca',
  '/poradniki',
  '/dla-pracodawcow',
  '/o-nas',
  '/kontakt',
  '/pomoc',
  '/regulamin',
  '/polityka-prywatnosci',
  '/polityka-cookies',
  '/zglos-tresc',
  '/logowanie',
  '/rejestracja',
  '/rejestracja-pracodawca',
  '/reset-hasla',
];

const SITE_ACCESS_PATH = '/api/site-access';
const SITE_ACCESS_COOKIE = 'pb_site_access';
const GATE_MARKER = `action="${SITE_ACCESS_PATH}"`;
const DEFAULT_BASE_URL = 'https://pracuj.be';
/** Identyfikator pliku ze stronami statycznymi w indeksie sitemap (`sitemap.ts`, #599). */
export const SITEMAP_STATIC_ID = 0;
const DEFAULT_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
const USER_AGENT = 'pracujbe-prod-smoke/1.0';
const LOCAL_HOST = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i;
/** Nagłówek sekretu monitoringu — ten sam co `HEALTH_TOKEN_HEADER` w `src/lib/ops/health-token.ts`. */
export const HEALTH_TOKEN_HEADER = 'x-health-token';
export const EXPECT_MODES = ['production', 'demo'];
/** HSTS krótszy niż rok nie kwalifikuje się do preload i nie chroni pierwszej wizyty po przerwie. */
export const HSTS_MIN_MAX_AGE = 31_536_000;
/** Polityki odsyłacza nie ujawniające ścieżki innym originom (`next.config.mjs` i middleware). */
const SAFE_REFERRER_POLICIES = new Set(['no-referrer', 'same-origin', 'strict-origin', 'strict-origin-when-cross-origin']);
/** Dyrektywy CSP, których brak oznacza, że nagłówki z `next.config.mjs` nie dotarły do klienta. */
const REQUIRED_CSP_DIRECTIVES = ["frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'"];

/**
 * Lista sprawdzeń: `expect` = dozwolone kody, `redirectToLocale` = 3xx na `/{locale}`,
 * `health` = JSON `{ status: "ok" }`, `page` = strona HTML z nagłówkami bezpieczeństwa,
 * `robots` = treść czytana do wykrycia partii sitemap ofert (#689, patrz `runSmoke`).
 * @returns {{ path: string, expect: number[], redirectToLocale?: boolean, health?: boolean, page?: boolean, robots?: boolean }[]}
 */
export function buildChecks() {
  const checks = [
    { path: '/api/health', expect: [200], health: true },
    { path: '/', expect: [307, 308], redirectToLocale: true },
    { path: '/robots.txt', expect: [200], robots: true },
    // Sitemap index (#599): `src/app/sitemap.ts` ma `generateSitemaps()`, więc Next.js serwuje
    // `/sitemap/<id>.xml` (0 = strony statyczne, 1..N = oferty), a `/sitemap.xml` daje 404.
    // Partie `1..N` dopisuje `runSmoke()` po odczytaniu `/robots.txt` (#689).
    { path: `/sitemap/${SITEMAP_STATIC_ID}.xml`, expect: [200] },
  ];
  for (const locale of LOCALES) {
    for (const page of LOCALIZED_PAGES) checks.push({ path: `/${locale}${page}`, expect: [200], page: true });
  }
  return checks;
}

/**
 * @returns {{ baseUrl: URL, password: string | undefined, timeoutMs: number,
 *   expectMode: 'production' | 'demo' | undefined, expectSha: string | undefined,
 *   healthToken: string | undefined } | null}
 */
export function readConfig(env) {
  const rawBase = env.PROD_SMOKE_BASE_URL?.trim() || DEFAULT_BASE_URL;
  let baseUrl;
  try {
    baseUrl = new URL(rawBase);
  } catch {
    return null;
  }
  const secure = baseUrl.protocol === 'https:' || (baseUrl.protocol === 'http:' && LOCAL_HOST.test(baseUrl.hostname));
  if (!secure || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash || rawBase.includes('#')) {
    return null;
  }
  const rawTimeout = env.PROD_SMOKE_TIMEOUT_MS?.trim();
  const timeoutMs = rawTimeout ? Number(rawTimeout) : DEFAULT_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 120_000) return null;
  const password = env.SITE_ACCESS_PASSWORD?.trim() || undefined;
  const expectMode = env.PROD_SMOKE_EXPECT_MODE?.trim() || undefined;
  if (expectMode !== undefined && !EXPECT_MODES.includes(expectMode)) return null;
  const expectSha = env.PROD_SMOKE_EXPECT_SHA?.trim().toLowerCase() || undefined;
  if (expectSha !== undefined && !/^[0-9a-f]{7,40}$/.test(expectSha)) return null;
  const healthToken = env.HEALTH_CHECK_SECRET?.trim() || undefined;
  return { baseUrl, password, timeoutMs, expectMode, expectSha, healthToken };
}

/**
 * Nagłówki bezpieczeństwa jednej strony HTML. Zwraca listę problemów (pusta = zgodne);
 * wartości nagłówków nie trafiają do komunikatów poza nazwą i oczekiwaniem.
 * @param {Headers} headers
 * @param {{ https: boolean, expectMode?: 'production' | 'demo' }} options
 * @returns {string[]}
 */
export function securityHeaderProblems(headers, { https, expectMode }) {
  const problems = [];
  const csp = headers.get('content-security-policy');
  if (!csp) {
    problems.push('brak Content-Security-Policy');
  } else {
    const directives = csp.split(';').map((part) => part.trim().replace(/\s+/g, ' ').toLowerCase());
    for (const directive of REQUIRED_CSP_DIRECTIVES) {
      if (!directives.includes(directive)) problems.push(`CSP bez ${directive}`);
    }
  }
  if (headers.get('x-content-type-options')?.trim().toLowerCase() !== 'nosniff') problems.push('brak X-Content-Type-Options: nosniff');
  if (headers.get('x-frame-options')?.trim().toUpperCase() !== 'DENY') problems.push('brak X-Frame-Options: DENY');
  // Kilka wartości po przecinku: przeglądarka stosuje ostatnią rozpoznaną.
  const referrer = headers.get('referrer-policy')?.split(',').map((value) => value.trim().toLowerCase()).filter(Boolean).at(-1);
  if (!referrer || !SAFE_REFERRER_POLICIES.has(referrer)) problems.push('Referrer-Policy nieustawiona albo ujawniająca ścieżkę');

  const noindex = /\bnoindex\b/i.test(headers.get('x-robots-tag') ?? '');
  if (expectMode === 'production') {
    if (https) {
      const maxAge = Number(/(?:^|;)\s*max-age\s*=\s*"?(\d+)"?/i.exec(headers.get('strict-transport-security') ?? '')?.[1] ?? NaN);
      if (!(maxAge >= HSTS_MIN_MAX_AGE)) problems.push(`brak HSTS z max-age ≥ ${HSTS_MIN_MAX_AGE}`);
    }
    if (noindex) problems.push('X-Robots-Tag: noindex w trybie produkcyjnym');
  } else if (expectMode === 'demo' && !noindex) {
    problems.push('brak X-Robots-Tag: noindex poza produkcją');
  }
  return problems;
}

/**
 * Czy `version` z health (`0.YYYYMMDD.M+sha8` albo `1.0.0+sha8`, `scripts/build-version.mjs`)
 * wskazuje oczekiwany commit. Porównanie po wspólnym prefiksie skrótu (7 lub 8 znaków).
 */
export function versionMatchesSha(version, expectedSha) {
  const revision = typeof version === 'string' ? /\+([0-9a-f]{7,40})$/i.exec(version)?.[1]?.toLowerCase() : undefined;
  if (!revision) return false;
  const length = Math.min(revision.length, expectedSha.length);
  return length >= 7 && revision.slice(0, length) === expectedSha.slice(0, length);
}

/**
 * Ścieżki partii sitemap ofert (`/sitemap/<id>.xml`, `id` ≥ 1) wskazane w treści `robots.txt`
 * (#689). Tylko linie `Sitemap:` (dowolna wielkość liter, RFC bez formalnej specyfikacji
 * pisowni), tylko TEN SAM origin co `baseUrl` (nigdy cudzy host z treści odpowiedzi) i tylko
 * wzorzec `generateSitemaps()` (`src/app/sitemap.ts`/`src/app/robots.ts`) — inny wpis
 * (np. przyszły `sitemap-images.xml`) jest pomijany, nie sprawdzany na ślepo. `id=0` (statyczne
 * strony) wraca z `buildChecks()`, więc go tu wykluczamy, żeby nie sprawdzać go dwa razy.
 * @param {string} robotsText
 * @param {URL} baseUrl
 * @returns {string[]}
 */
export function parseRobotsSitemapShardPaths(robotsText, baseUrl) {
  const paths = [];
  for (const line of robotsText.split(/\r?\n/)) {
    const match = /^\s*sitemap\s*:\s*(\S+)\s*$/i.exec(line);
    if (!match) continue;
    let url;
    try {
      url = new URL(match[1], baseUrl);
    } catch {
      continue;
    }
    if (url.origin !== baseUrl.origin) continue;
    const shard = /^\/sitemap\/(\d+)\.xml$/.exec(url.pathname);
    if (!shard || Number(shard[1]) === SITEMAP_STATIC_ID) continue;
    if (!paths.includes(url.pathname)) paths.push(url.pathname);
  }
  return paths.sort((a, b) => Number(/\d+/.exec(a)?.[0]) - Number(/\d+/.exec(b)?.[0]));
}

async function timedFetch(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
    return { response, ms: Math.round(performance.now() - started) };
  } catch {
    return { error: controller.signal.aborted ? 'timeout' : 'network', ms: Math.round(performance.now() - started) };
  } finally {
    clearTimeout(timer);
  }
}

/** Odczyt treści z tym samym limitem czasu (wolny strumień nie może zawiesić smoke testu). */
async function readText(response, timeoutMs) {
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    return await Promise.race([response.text().catch(() => null), timeout]);
  } finally {
    clearTimeout(timer);
    await response.body?.cancel().catch(() => {});
  }
}

/** Logowanie przez bramkę. Zwraca wartość nagłówka Cookie albo null (błąd — bez szczegółów). */
async function loginThroughGate({ baseUrl, password, timeoutMs }, fetchImpl) {
  const body = new URLSearchParams({ password, next: '/pl', locale: 'pl' });
  const result = await timedFetch(
    fetchImpl,
    new URL(SITE_ACCESS_PATH, baseUrl).href,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'user-agent': USER_AGENT },
      body: body.toString(),
    },
    timeoutMs,
  );
  if (!result.response) return { error: result.error };
  const { response } = result;
  await response.body?.cancel().catch(() => {});
  const location = response.headers.get('location') ?? '';
  const setCookies = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie') ?? ''];
  const cookie = setCookies
    .map((value) => value.split(';')[0]?.trim() ?? '')
    .find((pair) => pair.startsWith(`${SITE_ACCESS_COOKIE}=`) && pair.length > SITE_ACCESS_COOKIE.length + 1);
  if (response.status !== 303 || location.includes('pb_access=denied') || !cookie) {
    return { error: 'denied', status: response.status };
  }
  return { cookie };
}

async function runCheck(check, config, fetchImpl, cookie) {
  const headers = { 'user-agent': USER_AGENT, accept: check.health ? 'application/json' : 'text/html' };
  if (cookie) headers.cookie = cookie;
  if (check.health && config.healthToken) headers[HEALTH_TOKEN_HEADER] = config.healthToken;
  const result = await timedFetch(fetchImpl, new URL(check.path, config.baseUrl).href, { method: 'GET', headers }, config.timeoutMs);
  if (!result.response) {
    return { ok: false, path: check.path, ms: result.ms, reason: result.error === 'timeout' ? 'przekroczono czas' : 'błąd połączenia' };
  }
  const { response, ms } = result;
  const status = response.status;
  const base = { path: check.path, status, ms };

  if (status >= 500) {
    // Rozpoznanie strony bramki: 503 z formularzem hasła to nie awaria serwera, tylko brak dostępu.
    const text = await readText(response, config.timeoutMs);
    const gate = status === 503 && typeof text === 'string' && text.includes(GATE_MARKER);
    return { ...base, ok: false, gate, reason: gate ? 'bramka hasła (brak dostępu)' : 'błąd serwera 5xx' };
  }
  if (!check.expect.includes(status)) {
    await response.body?.cancel().catch(() => {});
    return { ...base, ok: false, reason: `oczekiwano ${check.expect.join('/')}` };
  }
  if (check.redirectToLocale) {
    await response.body?.cancel().catch(() => {});
    const location = response.headers.get('location') ?? '';
    let target = '';
    try {
      const url = new URL(location, config.baseUrl);
      target = url.origin === config.baseUrl.origin ? url.pathname : '';
    } catch {
      target = '';
    }
    const ok = LOCALES.some((locale) => target === `/${locale}` || target.startsWith(`/${locale}/`));
    return ok ? { ...base, ok: true } : { ...base, ok: false, reason: 'przekierowanie poza /{język}' };
  }
  if (check.health) {
    const text = await readText(response, config.timeoutMs);
    let health;
    try {
      health = JSON.parse(text ?? '');
    } catch {
      health = undefined;
    }
    if (health?.status !== 'ok') return { ...base, ok: false, reason: 'health bez status "ok"' };
    if (config.expectSha) {
      if (typeof health.version !== 'string' || !health.version) {
        return { ...base, ok: false, reason: 'health bez pola version (w produkcji ustaw HEALTH_CHECK_SECRET)' };
      }
      if (!versionMatchesSha(health.version, config.expectSha)) {
        return { ...base, ok: false, reason: `wdrożona wersja ${health.version} ≠ oczekiwany SHA ${config.expectSha.slice(0, 8)}` };
      }
    }
    return { ...base, ok: true };
  }
  if (check.robots) {
    // Treść potrzebna do wykrycia partii sitemap ofert (#689) — nie odrzucamy body jak niżej.
    const text = await readText(response, config.timeoutMs);
    return { ...base, ok: true, body: text ?? '' };
  }
  await response.body?.cancel().catch(() => {});
  if (check.page) {
    const problems = securityHeaderProblems(response.headers, { https: config.baseUrl.protocol === 'https:', expectMode: config.expectMode });
    if (problems.length > 0) return { ...base, ok: false, reason: `nagłówki: ${problems.join('; ')}` };
  }
  return { ...base, ok: true };
}

async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch,
 *   logger?: Pick<Console, 'log' | 'error'>, checks?: ReturnType<typeof buildChecks> }} options
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runSmoke({ env = process.env, fetchImpl = fetch, logger = console, checks = buildChecks() } = {}) {
  const config = readConfig(env);
  if (!config) {
    logger.error(
      'Nieprawidłowa konfiguracja: PROD_SMOKE_BASE_URL (https, sam origin), PROD_SMOKE_TIMEOUT_MS (100–120000), ' +
        'PROD_SMOKE_EXPECT_MODE (production|demo) lub PROD_SMOKE_EXPECT_SHA (7–40 znaków hex).',
    );
    return 2;
  }
  logger.log(`Smoke test: ${config.baseUrl.origin} — ${checks.length} sprawdzeń, limit ${config.timeoutMs} ms na żądanie.`);
  logger.log(
    `Tryb: ${config.expectMode ?? 'nie sprawdzany'}; SHA: ${config.expectSha ? config.expectSha.slice(0, 8) : 'nie sprawdzany'}` +
      `${config.healthToken ? '; health z sekretem monitoringu' : ''}.`,
  );

  let cookie;
  if (config.password) {
    const login = await loginThroughGate(config, fetchImpl);
    if (!login.cookie) {
      const detail = login.error === 'timeout' ? 'przekroczono czas' : login.error === 'network' ? 'błąd połączenia' : `HTTP ${login.status}`;
      logger.error(`BŁĄD  bramka hasła: logowanie nieudane (${detail}). Sprawdź SITE_ACCESS_PASSWORD.`);
      return 1;
    }
    cookie = login.cookie;
    logger.log('OK    bramka hasła: zalogowano.');
  } else {
    logger.log('Bez SITE_ACCESS_PASSWORD — sprawdzenie bez logowania przez bramkę.');
  }

  const results = await mapLimited(checks, CONCURRENCY, (check) => runCheck(check, config, fetchImpl, cookie));

  // #689: partie sitemap ofert (`/sitemap/1.xml`, `2.xml`, …) wskazane w treści `/robots.txt`,
  // ale nieobecne na statycznej liście (tylko `id=0`) — dopisujemy sprawdzenie dla każdej,
  // zamiast kończyć smoke test z pominiętym generowaniem katalogu ofert.
  const robotsResult = results.find((result) => typeof result.body === 'string');
  let allResults = results;
  if (robotsResult) {
    const known = new Set(checks.map((check) => check.path));
    const shardPaths = parseRobotsSitemapShardPaths(robotsResult.body, config.baseUrl).filter((path) => !known.has(path));
    if (shardPaths.length > 0) {
      const shardChecks = shardPaths.map((path) => ({ path, expect: [200] }));
      const shardResults = await mapLimited(shardChecks, CONCURRENCY, (check) => runCheck(check, config, fetchImpl, cookie));
      allResults = [...results, ...shardResults];
    }
  }

  for (const result of allResults) {
    const status = result.status === undefined ? '---' : String(result.status);
    const line = `${status.padEnd(4)} ${String(result.ms).padStart(6)} ms  ${result.path}`;
    if (result.ok) logger.log(`OK    ${line}`);
    else logger.error(`BŁĄD  ${line}  — ${result.reason}`);
  }

  const failures = allResults.filter((result) => !result.ok);
  if (!config.password && failures.some((result) => result.gate)) {
    logger.error('Strony zwracają bramkę hasła — ustaw SITE_ACCESS_PASSWORD w środowisku uruchomienia.');
  }
  if (failures.length > 0) {
    logger.error(`Wynik: ${failures.length} z ${allResults.length} sprawdzeń nieudanych.`);
    return 1;
  }
  logger.log(`Wynik: wszystkie ${allResults.length} sprawdzeń zgodne.`);
  return 0;
}

// Import w testach nie uruchamia żądań ani nie kończy procesu testowego.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await runSmoke());
}
