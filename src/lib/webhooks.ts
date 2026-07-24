import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Weryfikacja podpisu Standard Webhooks (https://www.standardwebhooks.com/) — używane m.in.
 * przez Supabase Auth „Send Email Hook". Wydzielone z route handlera, aby było jednostkowo
 * testowalne i reużywalne (np. przyszły webhook Resend delivered/bounced).
 *
 * Kontrakt Standard Webhooks:
 *   - nagłówki: webhook-id, webhook-timestamp (Unix, sekundy), webhook-signature,
 *   - podpisywana treść: `${id}.${timestamp}.${rawBody}`,
 *   - podpis: base64(HMAC-SHA256(secret, content)), nagłówek może mieć wiele podpisów
 *     rozdzielonych spacją, każdy w formie 'v1,<base64>',
 *   - sekret: 'whsec_<base64>' — dostawcy (Supabase) mogą poprzedzić go 'v1,' → obcinamy oba.
 *
 * Ochrona przed replayem: znacznik czasu musi mieścić się w oknie ±toleranceSeconds.
 * Porównanie podpisów jest stałoczasowe (timingSafeEqual).
 */

export interface StandardWebhookHeaders {
  id: string | null;
  timestamp: string | null;
  signature: string | null;
}

export interface VerifyOptions {
  /** Dopuszczalny wiek żądania w sekundach (domyślnie 300). */
  toleranceSeconds?: number;
  /** Bieżący czas w sekundach (wstrzykiwane w testach; domyślnie Date.now()/1000). */
  nowSeconds?: number;
}

/** Obcina prefiksy dostawcy z sekretu: 'v1,whsec_<b64>' lub 'whsec_<b64>' → '<b64>'. */
export function normalizeWebhookSecret(secret: string): string {
  return secret.replace(/^v1,/, '').replace(/^whsec_/, '');
}

/**
 * Zwraca true, gdy podpis jest poprawny i znacznik czasu jest świeży. Fail-closed:
 * brak nagłówka / zły format / nieświeży timestamp / zły podpis → false.
 */
export function verifyStandardWebhook(
  secret: string,
  headers: StandardWebhookHeaders,
  rawBody: string,
  options: VerifyOptions = {},
): boolean {
  const { id, timestamp, signature } = headers;
  if (!id || !timestamp || !signature) return false;

  const toleranceSeconds = options.toleranceSeconds ?? 300;
  const nowSeconds = options.nowSeconds ?? Date.now() / 1000;

  // Świeżość znacznika czasu (anty-replay): odrzuć nieparsowalny lub spoza okna ±tolerancja.
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSeconds - ts) > toleranceSeconds) return false;

  let key: Buffer;
  try {
    key = Buffer.from(normalizeWebhookSecret(secret), 'base64');
  } catch {
    return false;
  }
  if (key.length === 0) return false;

  const expected = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  const expectedBuf = Buffer.from(expected);

  // Nagłówek może zawierać wiele podpisów oddzielonych spacją, każdy w formie 'v1,<sig>'.
  for (const part of signature.split(' ')) {
    const value = part.includes(',') ? part.split(',')[1] : part;
    if (!value) continue;
    const candidate = Buffer.from(value);
    if (candidate.length === expectedBuf.length && timingSafeEqual(candidate, expectedBuf)) {
      return true;
    }
  }
  return false;
}

/** Podpisuje treść jak Standard Webhooks (do testów / self-hooków). Zwraca 'v1,<base64>'. */
export function signStandardWebhook(secret: string, id: string, timestamp: string, rawBody: string): string {
  const key = Buffer.from(normalizeWebhookSecret(secret), 'base64');
  const sig = createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');
  return `v1,${sig}`;
}
