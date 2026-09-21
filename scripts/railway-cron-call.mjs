import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Jednorazowe wywołanie zadania przez prywatną sieć Railway.
 * Logujemy wyłącznie stały komunikat i kod HTTP, nigdy adres, sekret ani treść.
 * @param {{ env?: Record<string, string | undefined>, fetchImpl?: typeof fetch,
 * logger?: Pick<Console, 'log' | 'error'> }} options
 * @returns {Promise<0 | 1 | 2>}
 */
export async function runCron({ env = process.env, fetchImpl = fetch, logger = console } = {}) {
  const target = env.CRON_TARGET_URL;
  const secret = env.CRON_AUTH_SECRET;
  let url;
  try {
    if (!target || !secret || !/^[\x21-\x7e]+$/u.test(secret)) {
      throw new Error();
    }
    url = new URL(target);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || target.includes('#')) {
      throw new Error();
    }
  } catch {
    logger.error('Nieprawidłowa konfiguracja zadania cron.');
    return 2;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
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
