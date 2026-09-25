import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Autentyczność webhooków EmailLabs (Konto → Ustawienia → Webhooki).
 *
 * EmailLabs dołącza do każdego żądania nagłówki `X-Webhook-Date`, `Request-Id` oraz
 * `X-Webhook-Checksum` = SHA1(`<SecretKey>|<X-Webhook-Date>|<Request-Id>`). Suma NIE obejmuje
 * treści, dlatego:
 * - `Request-Id` jest kluczem inboxu `processed_webhooks` — powtórzone (przechwycone) żądanie
 *   z tym samym identyfikatorem nie zostanie przetworzone drugi raz,
 * - panel pozwala dodatkowo włączyć Basic auth; gdy ustawione są
 *   `EMAILLABS_WEBHOOK_BASIC_USER` i `EMAILLABS_WEBHOOK_BASIC_PASSWORD`, wymagamy go także.
 * Format `X-Webhook-Date` nie jest opisany (strefa czasowa), więc nie sprawdzamy świeżości —
 * przed powtórzeniem chroni inbox.
 */

export interface EmailLabsWebhookHeaders {
  date: string | null;
  checksum: string | null;
  requestId: string | null;
  authorization: string | null;
}

export interface EmailLabsWebhookAuth {
  secret: string;
  basicUser?: string | null;
  basicPassword?: string | null;
}

const MAX_HEADER_LENGTH = 200;

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/** Suma kontrolna EmailLabs (hex SHA1) — eksport dla testów i atrapy dostawcy. */
export function emailLabsChecksum(secret: string, date: string, requestId: string): string {
  return createHash('sha1').update(`${secret}|${date}|${requestId}`).digest('hex');
}

function basicAuthMatches(header: string | null, user: string, password: string): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const expected = `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`;
  return safeEqual(header, expected);
}

/** Fail-closed: brak nagłówka, zły format, zła suma albo brak wymaganego Basic auth → false. */
export function verifyEmailLabsWebhook(auth: EmailLabsWebhookAuth, headers: EmailLabsWebhookHeaders): boolean {
  const { date, checksum, requestId } = headers;
  if (!auth.secret || !date || !checksum || !requestId) return false;
  if (date.length > MAX_HEADER_LENGTH || requestId.length > MAX_HEADER_LENGTH) return false;
  if (!/^[0-9a-fA-F]{40}$/.test(checksum.trim())) return false;

  const expected = emailLabsChecksum(auth.secret, date, requestId);
  const checksumOk = safeEqual(checksum.trim().toLowerCase(), expected);

  const basicRequired = Boolean(auth.basicUser && auth.basicPassword);
  const basicOk = !basicRequired ||
    basicAuthMatches(headers.authorization, auth.basicUser as string, auth.basicPassword as string);
  return checksumOk && basicOk;
}
