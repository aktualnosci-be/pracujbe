import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Jedyne zadania, które caller może wywołać (#13) — sekret nie trafi pod inny adres. */
export const CRON_PATHS = Object.freeze(['/api/email/process', '/api/maintenance']);
export const DEFAULT_TIMEOUT_SECONDS = 120;
const MAX_TIMEOUT_SECONDS = 600;

/** Zwykłe HTTP tylko w sieci prywatnej Railway (`*.railway.internal`) i lokalnie; poza nią HTTPS. */
function isPrivateHost(hostname) {
  return hostname.endsWith('.railway.internal') || ['localhost', '127.0.0.1', '[::1]'].includes(hostname);
}

/** Opcjonalny `CRON_TIMEOUT_SECONDS`: liczba całkowita 1–600; brak = 120 s. */
function timeoutMs(value) {
  if (value === undefined || value === '') return DEFAULT_TIMEOUT_SECONDS * 1000;
  if (!/^[1-9][0-9]{0,2}$/u.test(value) || Number(value) > MAX_TIMEOUT_SECONDS) return null;
  return Number(value) * 1000;
}

/**
 * Jednorazowe wywołanie zadania przez prywatną sieć Railway.
 * Logujemy wyłącznie stały komunikat i kod HTTP, nigdy adres, sekret ani treść.
 * Kody wyjścia: 0 = HTTP 2xx; 1 = błąd żądania, HTTP spoza 2xx albo przekroczony czas;
 * 2 = błędna konfiguracja (żądanie nie zostało wysłane).
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch,
 * logger?: Pick<Console, 'log' | 'error'> }} options
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runCron({ env = process.env, fetchImpl = fetch, logger = console } = {}) {
  const target = env.CRON_TARGET_URL;
  const secret = env.CRON_AUTH_SECRET;
  const timeout = timeoutMs(env.CRON_TIMEOUT_SECONDS);
  let url;
  try {
    if (!target || !secret || !/^[\x21-\x7e]+$/u.test(secret) || timeout === null) {
      throw new Error();
    }
    url = new URL(target);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (url.protocol === 'http:' && !isPrivateHost(url.hostname)) ||
      url.username || url.password ||
      target.includes('#') || target.includes('?') ||
      !CRON_PATHS.includes(url.pathname)
    ) {
      throw new Error();
    }
  } catch {
    logger.error('Nieprawidłowa konfiguracja zadania cron.');
    return 2;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(url.href, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${secret}`,
        'user-agent': 'pracujbe-railway-cron/1.0',
      },
      redirect: 'error',
      signal: controller.signal,
    });
    // Odpowiedź może zawierać PII; nie czytamy jej i nie utrzymujemy strumienia.
    await response.body?.cancel();
    if (!response.ok) {
      logger.error(`Zadanie cron zakończone błędem HTTP ${response.status}.`);
      return 1;
    }
    logger.log(`Zadanie cron zakończone: HTTP ${response.status}.`);
    return 0;
  } catch {
    logger.error(controller.signal.aborted ? 'Przekroczono czas zadania cron.' : 'Wywołanie zadania cron nie powiodło się.');
    return 1;
  } finally {
    clearTimeout(timer);
  }
}

// Import w testach nie uruchamia żądania ani nie kończy procesu testowego.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  process.exit(await runCron());
}
