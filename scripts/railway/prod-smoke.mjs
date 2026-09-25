import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Smoke test produkcji (#16, #18) — uruchamiany ręcznie przez operatora, POZA CI.
 *
 * Sprawdza trasy publiczne i auth w czterech językach, `/`, `/robots.txt`, `/sitemap.xml`
 * oraz `/api/health`: oczekiwany kod odpowiedzi, brak 5xx, limit czasu każdego żądania.
 * Tylko GET na stronach, które nie zmieniają danych — nie zakłada kont, nie aplikuje,
 * nie wysyła e-maili (testy niszczące dane wyłącznie w izolowanej bazie, #16).
 *
 * Bramka hasła (`SITE_ACCESS_PASSWORD`, `src/lib/site-access.ts`): jeśli zmienna jest
 * ustawiona w środowisku operatora, skrypt loguje się przez `POST /api/site-access` i używa
 * wydanego cookie. Hasła i cookie nie wypisujemy nigdy; hasło nie trafia do adresu URL
 * i jest wysyłane wyłącznie przez HTTPS (http tylko dla localhost — testy lokalne).
 *
 * Zmienne: PROD_SMOKE_BASE_URL (domyślnie https://pracuj.be), SITE_ACCESS_PASSWORD
 * (opcjonalnie), PROD_SMOKE_TIMEOUT_MS (domyślnie 15000).
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
  '/faq',
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
const DEFAULT_TIMEOUT_MS = 15_000;
const CONCURRENCY = 4;
const USER_AGENT = 'pracujbe-prod-smoke/1.0';
const LOCAL_HOST = /^(localhost|127(?:\.\d+){3}|\[::1\])$/i;

/**
 * Lista sprawdzeń: `expect` = dozwolone kody, `redirectToLocale` = 3xx na `/{locale}`,
 * `health` = JSON `{ status: "ok" }`.
 * @returns {{ path: string, expect: number[], redirectToLocale?: boolean, health?: boolean }[]}
 */
export function buildChecks() {
  const checks = [
    { path: '/api/health', expect: [200], health: true },
    { path: '/', expect: [307, 308], redirectToLocale: true },
    { path: '/robots.txt', expect: [200] },
    { path: '/sitemap.xml', expect: [200] },
  ];
  for (const locale of LOCALES) {
    for (const page of LOCALIZED_PAGES) checks.push({ path: `/${locale}${page}`, expect: [200] });
  }
  return checks;
}

/** @returns {{ baseUrl: URL, password: string | undefined, timeoutMs: number } | null} */
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
  return { baseUrl, password, timeoutMs };
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
    let healthStatus;
    try {
      healthStatus = JSON.parse(text ?? '')?.status;
    } catch {
      healthStatus = undefined;
    }
    return healthStatus === 'ok' ? { ...base, ok: true } : { ...base, ok: false, reason: 'health bez status "ok"' };
  }
  await response.body?.cancel().catch(() => {});
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
    logger.error('Nieprawidłowa konfiguracja: PROD_SMOKE_BASE_URL (https, sam origin) lub PROD_SMOKE_TIMEOUT_MS (100–120000).');
    return 2;
  }
  logger.log(`Smoke test: ${config.baseUrl.origin} — ${checks.length} sprawdzeń, limit ${config.timeoutMs} ms na żądanie.`);

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
  for (const result of results) {
    const status = result.status === undefined ? '---' : String(result.status);
    const line = `${status.padEnd(4)} ${String(result.ms).padStart(6)} ms  ${result.path}`;
    if (result.ok) logger.log(`OK    ${line}`);
    else logger.error(`BŁĄD  ${line}  — ${result.reason}`);
  }

  const failures = results.filter((result) => !result.ok);
  if (!config.password && failures.some((result) => result.gate)) {
    logger.error('Strony zwracają bramkę hasła — ustaw SITE_ACCESS_PASSWORD w środowisku uruchomienia.');
  }
  if (failures.length > 0) {
    logger.error(`Wynik: ${failures.length} z ${results.length} sprawdzeń nieudanych.`);
    return 1;
  }
  logger.log(`Wynik: wszystkie ${results.length} sprawdzeń zgodne.`);
  return 0;
}

// Import w testach nie uruchamia żądań ani nie kończy procesu testowego.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await runSmoke());
}
