import 'server-only';

import { isValidVapidSubject, vapidPrivateKey, type VapidKeys } from '@/lib/push/vapid';

/**
 * Konfiguracja Web Push (#724). Funkcja jest WŁĄCZONA tylko gdy:
 *   - `WEB_PUSH_ENABLED` = `1`/`true` (domyślnie wyłączona, także w produkcji), ORAZ
 *   - są poprawne klucze VAPID: `WEB_PUSH_VAPID_PUBLIC_KEY` + `WEB_PUSH_VAPID_PRIVATE_KEY`
 *     (para P-256 w base64url, spójna) i `WEB_PUSH_VAPID_SUBJECT` (`mailto:` albo `https:`).
 * Klucz prywatny nigdy nie opuszcza serwera; publiczny trafia do przeglądarki jako
 * `applicationServerKey` (prop z komponentu serwerowego, bez `NEXT_PUBLIC_*`).
 * Brak/niepoprawna konfiguracja = funkcja wyłączona (bez sekcji w ustawieniach, bez wysyłek).
 */

export function isWebPushFlagOn(env: NodeJS.ProcessEnv = process.env): boolean {
  const flag = (env.WEB_PUSH_ENABLED ?? '').trim().toLowerCase();
  return flag === '1' || flag === 'true';
}

export function webPushConfig(env: NodeJS.ProcessEnv = process.env): VapidKeys | null {
  if (!isWebPushFlagOn(env)) return null;
  const publicKey = (env.WEB_PUSH_VAPID_PUBLIC_KEY ?? '').trim();
  const privateKey = (env.WEB_PUSH_VAPID_PRIVATE_KEY ?? '').trim();
  const subject = (env.WEB_PUSH_VAPID_SUBJECT ?? '').trim();
  if (!publicKey || !privateKey || !isValidVapidSubject(subject)) return null;
  try {
    vapidPrivateKey({ publicKey, privateKey });
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

export function isWebPushEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return webPushConfig(env) !== null;
}

/** Klucz publiczny VAPID dla przeglądarki albo `null`, gdy funkcja jest wyłączona. */
export function webPushPublicKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return webPushConfig(env)?.publicKey ?? null;
}
