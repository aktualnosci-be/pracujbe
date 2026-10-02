import { encryptPushPayload, PushEncryptionError } from '@/lib/push/encrypt';
import { isAllowedPushEndpoint } from '@/lib/push/endpoint';
import { vapidAuthorization, type VapidKeys } from '@/lib/push/vapid';

/**
 * Jedno żądanie Web Push (RFC 8030) do usługi push przeglądarki (#724). Endpoint ponownie
 * sprawdzany listą dozwolonych usług (druga granica po CHECK w bazie), bez podążania za
 * przekierowaniami, z limitem czasu. Wynik to wyłącznie stały kod (Invariant #8) — treść
 * odpowiedzi dostawcy nie jest czytana ani zapisywana.
 */

export type PushSendOutcome =
  | { kind: 'sent' }
  | { kind: 'gone'; code: string }
  | { kind: 'retry'; code: string; retryAfterSeconds: number | null }
  | { kind: 'failed'; code: string };

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushSendOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** TTL w usłudze push (s): alert nieaktualny po dobie. */
  ttlSeconds?: number;
}

/** `Retry-After` w sekundach albo jako data HTTP; nieczytelny = null. Najwyżej 6 h. */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  if (!value) return null;
  const trimmed = value.trim();
  let seconds: number | null = null;
  if (/^\d{1,9}$/.test(trimmed)) seconds = Number(trimmed);
  else {
    const at = Date.parse(trimmed);
    if (Number.isFinite(at)) seconds = Math.max(0, Math.ceil((at - now) / 1000));
  }
  return seconds === null ? null : Math.min(seconds, 21_600);
}

export async function sendWebPush(
  target: PushTarget,
  payload: Uint8Array,
  keys: VapidKeys,
  options: PushSendOptions = {},
): Promise<PushSendOutcome> {
  if (!isAllowedPushEndpoint(target.endpoint)) return { kind: 'failed', code: 'endpoint' };
  let body: Buffer;
  try {
    body = encryptPushPayload({ p256dh: target.p256dh, auth: target.auth, plaintext: payload });
  } catch (error) {
    if (error instanceof PushEncryptionError) return { kind: 'failed', code: `encrypt_${error.reason}` };
    throw error;
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000);
  let response: Response;
  try {
    response = await fetchImpl(target.endpoint, {
      method: 'POST',
      redirect: 'manual',
      signal: controller.signal,
      headers: {
        Authorization: vapidAuthorization(target.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(options.ttlSeconds ?? 86_400),
        Urgency: 'normal',
      },
      body: new Uint8Array(body),
    });
  } catch {
    return { kind: 'retry', code: controller.signal.aborted ? 'timeout' : 'network', retryAfterSeconds: null };
  } finally {
    clearTimeout(timer);
  }
  // Treści odpowiedzi nie czytamy — zwalniamy strumień.
  void response.body?.cancel().catch(() => undefined);

  const status = response.status;
  if (status >= 200 && status < 300) return { kind: 'sent' };
  if (status === 404 || status === 410) return { kind: 'gone', code: `http_${status}` };
  if (status === 429 || status >= 500) {
    return { kind: 'retry', code: `http_${status}`, retryAfterSeconds: parseRetryAfter(response.headers.get('retry-after')) };
  }
  // 401/403 = problem z kluczem VAPID serwera, nie z urządzeniem — ponawiamy bez kary.
  if (status === 401 || status === 403) return { kind: 'retry', code: `http_${status}`, retryAfterSeconds: 3600 };
  return { kind: 'failed', code: `http_${status}` };
}
