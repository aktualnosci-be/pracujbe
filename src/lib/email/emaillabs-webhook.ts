import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Autentyczność webhooków EmailLabs (Konto → Ustawienia → Webhooki).
 *
 * EmailLabs dołącza do każdego żądania nagłówki `X-Webhook-Date`, `Request-Id` oraz
 * `X-Webhook-Checksum` = SHA1(`<SecretKey>|<X-Webhook-Date>|<Request-Id>`). Suma NIE obejmuje
 * treści, dlatego:
 * - `Request-Id` jest kluczem inboxu `processed_webhooks` — powtórzone (przechwycone) żądanie
 *   z tym samym identyfikatorem nie zostanie przetworzone drugi raz,
 * - Basic auth (`EMAILLABS_WEBHOOK_BASIC_USER` + `EMAILLABS_WEBHOOK_BASIC_PASSWORD`) jest
 *   wymagany w produkcji (decyzja właściciela 29.09.2026, #1234) — bez niego route zwraca 503;
 *   poza produkcją, gdy ustawiony, jest sprawdzany tak samo,
 * - świeżość: `X-Webhook-Date` (objęta sumą) musi mieścić się w oknie ±24 h od teraz
 *   (`EMAILLABS_WEBHOOK_MAX_AGE_MS`). Format nie jest opisany, więc parser jest tolerancyjny
 *   (ISO 8601, RFC 2822, `YYYY-MM-DD HH:MM:SS` jako UTC, sekundy/milisekundy epoki); okno
 *   pokrywa niepewność strefy. Data nieczytelna = odrzucenie (fail-closed). Stare przechwycone
 *   nagłówki nie przejdą więc także po wyczyszczeniu inboxu, a inbox pamięta `Request-Id`
 *   znacznie dłużej niż okno (`processed_webhooks_gc`: co najmniej 7 dni, domyślnie 30).
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
  /** Wymagaj Basic auth nawet bez skonfigurowanych danych (produkcja) — wtedy zawsze false. */
  requireBasic?: boolean;
  /** Bieżący czas (ms) dla kontroli świeżości; domyślnie `Date.now()`. */
  now?: number;
}

const MAX_HEADER_LENGTH = 200;

/** Okno świeżości `X-Webhook-Date` w obie strony (strefa czasowa nieznana). */
export const EMAILLABS_WEBHOOK_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Tolerancyjny odczyt `X-Webhook-Date`. Zwraca czas w ms albo `null`, gdy wartość nie jest
 * rozpoznawalną datą. Czas bez strefy jest traktowany jako UTC (okno ±24 h pokrywa różnicę).
 */
export function parseEmailLabsWebhookDate(value: string | null): number | null {
  if (!value) return null;
  const v = value.trim();
  if (!v || v.length > MAX_HEADER_LENGTH) return null;
  if (/^\d{10}$/.test(v)) return Number(v) * 1000;
  if (/^\d{13}$/.test(v)) return Number(v);
  const local = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/.exec(v);
  if (local) {
    const [, y, mo, d, h, mi, se] = local;
    const ms = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(se ?? '0'));
    const check = new Date(ms);
    // Odrzuć daty „przepełnione” (np. 2026-02-31), które Date.UTC po cichu przesuwa.
    if (check.getUTCMonth() !== Number(mo) - 1 || check.getUTCDate() !== Number(d)) return null;
    return ms;
  }
  // ISO 8601 ze strefą albo RFC 2822 — tylko formy zawierające rok, żeby nie zgadywać.
  if (!/\d{4}/.test(v)) return null;
  const parsed = Date.parse(v);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Czy data nagłówka mieści się w oknie świeżości względem `now`. */
export function isEmailLabsWebhookDateFresh(value: string | null, now: number = Date.now()): boolean {
  const ms = parseEmailLabsWebhookDate(value);
  return ms !== null && Math.abs(now - ms) <= EMAILLABS_WEBHOOK_MAX_AGE_MS;
}

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

/**
 * Fail-closed: brak nagłówka, zły format, zła suma, data spoza okna świeżości albo brak
 * wymaganego Basic auth → false.
 */
export function verifyEmailLabsWebhook(auth: EmailLabsWebhookAuth, headers: EmailLabsWebhookHeaders): boolean {
  const { date, checksum, requestId } = headers;
  if (!auth.secret || !date || !checksum || !requestId) return false;
  if (date.length > MAX_HEADER_LENGTH || requestId.length > MAX_HEADER_LENGTH) return false;
  if (!/^[0-9a-fA-F]{40}$/.test(checksum.trim())) return false;

  const expected = emailLabsChecksum(auth.secret, date, requestId);
  const checksumOk = safeEqual(checksum.trim().toLowerCase(), expected);

  const basicConfigured = Boolean(auth.basicUser && auth.basicPassword);
  const basicOk = basicConfigured
    ? basicAuthMatches(headers.authorization, auth.basicUser as string, auth.basicPassword as string)
    : !auth.requireBasic;
  const fresh = isEmailLabsWebhookDateFresh(date, auth.now ?? Date.now());
  return checksumOk && basicOk && fresh;
}
