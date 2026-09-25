import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Test wdrożeniowy produkcji (#12, #429) — tylko odczyt, bez logowania i bez formularzy.
 *
 * Sprawdza konkretny, działający artefakt pod adresem `SMOKE_BASE_URL`:
 * 1. `/api/health` = 200 `ok`; z `HEALTH_CHECK_SECRET` także `mode: production` i (przy
 *    `EXPECTED_SHA`) wersję artefaktu z tym SHA — zielony health na demo lub na starym
 *    deployu NIE przechodzi.
 * 2. Anonimowe `/{locale}/candidate|employer|admin` NIE renderują paneli (brak 200) — mają
 *    przekierować do logowania. Panel demo bez sesji = porażka.
 * 3. `robots.txt` nie blokuje całego serwisu, a strona główna ma canonical HTTPS z adresu bazowego.
 *
 * Nie loguje sekretów ani treści odpowiedzi. Kod wyjścia: 0 = OK, 1 = porażka, 2 = konfiguracja.
 * Użycie: `SMOKE_BASE_URL=https://pracuj.be HEALTH_CHECK_SECRET=… EXPECTED_SHA=<sha> node scripts/production-smoke.mjs`
 */

const PANELS = ['candidate', 'employer', 'admin'];
const LOCALES = ['pl', 'nl', 'fr', 'en'];

/**
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch }} options
 * @returns {Promise<{ ok: boolean, failures: string[], config?: true }>}
 */
export async function runProductionSmoke({ env = process.env, fetchImpl = fetch } = {}) {
  let base;
  try {
    base = new URL(env.SMOKE_BASE_URL ?? '');
    if (base.protocol !== 'https:' || base.pathname !== '/' || base.search || base.hash || base.username) throw new Error();
  } catch {
    return { ok: false, failures: ['SMOKE_BASE_URL musi być adresem https bez ścieżki'], config: true };
  }
  const origin = base.origin;
  const token = env.HEALTH_CHECK_SECRET;
  const expectedSha = env.EXPECTED_SHA?.trim().toLowerCase();
  const failures = [];
  const get = (path, headers = {}) =>
    fetchImpl(`${origin}${path}`, { redirect: 'manual', headers, signal: AbortSignal.timeout(20_000) });

  // 1. Health: publicznie tylko status; szczegóły (tryb, wersja) za tokenem.
  try {
    const response = await get('/api/health', token ? { 'x-health-token': token } : {});
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200 || body.status !== 'ok') failures.push(`health: HTTP ${response.status}, status=${String(body.status)}`);
    if (token) {
      if (body.mode !== 'production') failures.push(`health: mode=${String(body.mode)} (oczekiwano production)`);
      if (expectedSha) {
        const version = typeof body.version === 'string' ? body.version.toLowerCase() : '';
        const sha = version.split('+')[1] ?? '';
        if (!sha || !(expectedSha.startsWith(sha) || sha.startsWith(expectedSha))) {
          failures.push(`health: wersja ${version || 'brak'} nie odpowiada oczekiwanemu SHA`);
        }
      }
    } else if (expectedSha) {
      failures.push('EXPECTED_SHA wymaga HEALTH_CHECK_SECRET (wersja jest w szczegółach health)');
    }
  } catch {
    failures.push('health: brak odpowiedzi');
  }

  // 2. Panele bez sesji: nigdy 200 (demo), tylko przekierowanie do logowania.
  for (const locale of LOCALES) {
    for (const panel of PANELS) {
      const path = `/${locale}/${panel}`;
      try {
        const response = await get(path);
        const location = response.headers.get('location') ?? '';
        const toLogin = response.status >= 300 && response.status < 400 &&
          new URL(location, origin).pathname === `/${locale}/logowanie`;
        if (!toLogin) failures.push(`${path}: HTTP ${response.status} (oczekiwano przekierowania do logowania)`);
      } catch {
        failures.push(`${path}: brak odpowiedzi`);
      }
    }
  }

  // 3. Indeksowanie produkcji: robots bez „Disallow: /”, canonical HTTPS z adresu bazowego.
  try {
    const robots = await (await get('/robots.txt')).text();
    if (/^\s*disallow:\s*\/\s*$/imu.test(robots)) failures.push('robots.txt blokuje cały serwis (tryb nieprodukcyjny?)');
    const html = await (await get('/pl')).text();
    const canonical = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/u.exec(html)?.[1] ?? '';
    if (!canonical.startsWith(`${origin}/pl`)) failures.push(`canonical /pl: ${canonical || 'brak'} (oczekiwano ${origin}/pl)`);
  } catch {
    failures.push('robots/canonical: brak odpowiedzi');
  }

  return { ok: failures.length === 0, failures };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = await runProductionSmoke();
  for (const failure of result.failures) console.error(`✗ ${failure}`);
  if (result.ok) console.log('Test wdrożeniowy produkcji: OK');
  process.exit(result.ok ? 0 : result.config ? 2 : 1);
}
