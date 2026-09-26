/**
 * Cloudflare Worker z Cron Triggers — zastępczy harmonogram zadań pracuj.be, gdy plan
 * Railway nie pozwala dodać usługi cron. Semantyka jak `scripts/railway-cron-call.mjs`:
 * jeden POST pod stały adres zadania z sekretem `Authorization: Bearer`, bez czytania treści
 * odpowiedzi, bez podążania za przekierowaniem, z limitem czasu.
 *
 * Kody wyniku (`runTask`): 0 = HTTP 2xx; 1 = błąd żądania, HTTP spoza 2xx, przekierowanie
 * albo przekroczony czas; 2 = błędna konfiguracja (żądanie nie zostało wysłane). `scheduled`
 * rzuca błąd dla kodu ≠ 0, więc Cloudflare oznacza przebieg jako nieudany.
 *
 * Logi: wyłącznie stały komunikat, nazwa zadania i kod HTTP — nigdy adres, sekret ani treść.
 * Opis: docs/CLOUDFLARE_CRON.md.
 */

/** Harmonogram → zadanie. Klucze = `crons` w wrangler.toml (test pilnuje zgodności). */
export const CRON_TASKS = Object.freeze({
  '*/5 * * * *': Object.freeze({ name: 'emailQueue', path: '/api/email/process', secret: 'EMAIL_QUEUE_SECRET' }),
  '0 * * * *': Object.freeze({ name: 'maintenance', path: '/api/maintenance', secret: 'MAINTENANCE_SECRET' }),
});

export const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;
const USER_AGENT = 'pracujbe-cloudflare-cron/1.0';

/** Opcjonalny `CRON_TIMEOUT_SECONDS`: liczba całkowita 1–600; brak = 120 s. */
function timeoutMs(value) {
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_SECONDS * 1000;
  if (!/^[1-9][0-9]{0,2}$/u.test(String(value)) || Number(value) > MAX_TIMEOUT_SECONDS) return null;
  return Number(value) * 1000;
}

/**
 * Adres zadania: tylko `https://host` (bez ścieżki, query, fragmentu i danych logowania)
 * + stała ścieżka z `CRON_TASKS`. Inaczej `null` — sekret nie trafi pod inny adres.
 */
export function taskUrl(baseUrl, path) {
  if (typeof baseUrl !== 'string' || baseUrl.includes('?') || baseUrl.includes('#')) return null;
  let base;
  try {
    base = new URL(baseUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' || base.username || base.password || !['', '/'].includes(base.pathname)) return null;
  return new URL(path, base.origin).href;
}

/**
 * Jedno wywołanie zadania.
 * @param {{ task: { name: string, path: string, secret: string }, env: Record<string, unknown>,
 *   fetchImpl?: typeof fetch, logger?: Pick<Console, 'log' | 'error'> }} options
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runTask({ task, env, fetchImpl = fetch, logger = console }) {
  const secret = env?.[task.secret];
  const timeout = timeoutMs(env?.CRON_TIMEOUT_SECONDS);
  const url = taskUrl(env?.CRON_BASE_URL, task.path);
  if (typeof secret !== 'string' || !/^[\x21-\x7e]+$/u.test(secret) || timeout === null || url === null) {
    logger.error(`Nieprawidłowa konfiguracja zadania cron (${task.name}).`);
    return 2;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${secret}`, 'user-agent': USER_AGENT },
      // Workers nie obsługują `redirect: 'error'`; 3xx z `manual` traktujemy jako błąd.
      redirect: 'manual',
      signal: controller.signal,
    });
    // Odpowiedź może zawierać PII; nie czytamy jej i nie utrzymujemy strumienia.
    await response.body?.cancel();
    if (response.status < 200 || response.status > 299) {
      logger.error(`Zadanie cron ${task.name} zakończone błędem HTTP ${response.status}.`);
      return 1;
    }
    logger.log(`Zadanie cron ${task.name} zakończone: HTTP ${response.status}.`);
    return 0;
  } catch {
    logger.error(
      controller.signal.aborted
        ? `Przekroczono czas zadania cron ${task.name}.`
        : `Wywołanie zadania cron ${task.name} nie powiodło się.`,
    );
    return 1;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Obsługa Cron Trigger: nieznany harmonogram albo kod ≠ 0 = przebieg nieudany (wyjątek).
 * @param {{ cron?: string }} controller
 * @param {Record<string, unknown>} env
 * @param {{ fetchImpl?: typeof fetch, logger?: Pick<Console, 'log' | 'error'> }} [options]
 */
export async function handleScheduled(controller, env, { fetchImpl = fetch, logger = console } = {}) {
  const task = CRON_TASKS[controller?.cron];
  if (!task) {
    logger.error('Nieznany harmonogram zadania cron.');
    throw new Error('CRON_UNKNOWN_SCHEDULE');
  }
  const code = await runTask({ task, env, fetchImpl, logger });
  if (code !== 0) throw new Error(code === 2 ? 'CRON_MISCONFIGURED' : 'CRON_TASK_FAILED');
  return code;
}

const worker = {
  // `await` (nie `waitUntil`): wyjątek oznacza przebieg w Cloudflare jako nieudany.
  async scheduled(controller, env) {
    await handleScheduled(controller, env);
  },
};

export default worker;
