import { parseBelgianVat, type BelgianVatFormatError } from '@/lib/vies/belgian-vat';

/**
 * Adapter VIES (Komisja Europejska) dla belgijskich numerów VAT — tylko kod serwerowy (#92).
 *
 * Zasada nadrzędna: **awaria lub ograniczenie usługi nigdy nie jest wynikiem „nieważny”**.
 * Numer jest `invalid` wyłącznie wtedy, gdy poprawna odpowiedź (HTTP 2xx, JSON, bez
 * `actionSucceed:false`/`errorWrappers`) jawnie mówi `valid: false`, a pole `userError`
 * (semantyka bez publicznej specyfikacji — nie może być jedyną podstawą) tego nie przeczy.
 * Wszystko inne — HTTP 429/5xx/4xx, timeout, błąd sieci, `actionSucceed:false`, kody
 * `MS_MAX_CONCURRENT_REQ`/`SERVICE_UNAVAILABLE`/`MS_UNAVAILABLE`/`TIMEOUT`…, sprzeczna lub
 * nieznana odpowiedź — to `rate_limited` albo `unavailable`, czyli brak możliwości weryfikacji.
 *
 * Numer bez poprawnego formatu/sumy kontrolnej nie jest wysyłany (`format_invalid`).
 * Każda próba ma twardy timeout; ponowienia tylko dla stanów przejściowych, z wykładniczym
 * backoffem i pełnym jitterem. Adapter niczego nie loguje (brak PII i surowych odpowiedzi).
 */

export const VIES_ENDPOINT =
  'https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number';

/** Kody błędów VIES oznaczające limit równoległych zapytań (throttling). */
const RATE_LIMIT_CODES = new Set([
  'MS_MAX_CONCURRENT_REQ',
  'MS_MAX_CONCURRENT_REQ_TIME',
  'GLOBAL_MAX_CONCURRENT_REQ',
  'GLOBAL_MAX_CONCURRENT_REQ_TIME',
  'SERVER_BUSY',
]);

const NAME_MAX = 300;

export type ViesUnavailableReason =
  | 'timeout'
  | 'network'
  | 'http_error'
  | 'service_unavailable'
  | 'unexpected_response';

export type ViesCheckResult =
  | { status: 'format_invalid'; reason: BelgianVatFormatError }
  | {
      status: 'valid';
      vatNumber: string;
      /** Nazwa z rejestru; `null`, gdy VIES jej nie udostępnia (`---`). */
      name: string | null;
      /** Data zapytania podana przez VIES (`YYYY-MM-DD`) albo null. */
      requestDate: string | null;
      checkedAt: string;
    }
  | { status: 'invalid'; vatNumber: string; requestDate: string | null; checkedAt: string }
  | { status: 'rate_limited'; vatNumber: string }
  | { status: 'unavailable'; vatNumber: string; reason: ViesUnavailableReason };

type Attempt =
  | Extract<ViesCheckResult, { status: 'valid' | 'invalid' | 'rate_limited' | 'unavailable' }>;

export interface ViesClientOptions {
  fetch?: typeof fetch;
  /** Limit jednej próby (ms). */
  timeoutMs?: number;
  /** Łączna liczba prób (1 = bez ponowień). */
  attempts?: number;
  /** Podstawa backoffu (ms): opóźnienie = random() · base · 2^n. */
  backoffBaseMs?: number;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  now?: () => Date;
}

const DEFAULTS = {
  timeoutMs: 4000,
  attempts: 3,
  backoffBaseMs: 500,
} as const;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function classifyCode(code: unknown): 'rate_limited' | 'unavailable' {
  return typeof code === 'string' && RATE_LIMIT_CODES.has(code.trim().toUpperCase())
    ? 'rate_limited'
    : 'unavailable';
}

function errorCodeOf(body: Record<string, unknown>): string | null {
  const wrappers = body['errorWrappers'];
  if (Array.isArray(wrappers)) {
    for (const w of wrappers) {
      if (w && typeof w === 'object' && typeof (w as Record<string, unknown>)['error'] === 'string') {
        return (w as Record<string, string>)['error'] ?? null;
      }
    }
  }
  return null;
}

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim();
  if (name === '' || /^-+$/.test(name)) return null;
  return name.slice(0, NAME_MAX);
}

function cleanDate(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(raw);
  return match?.[1] ?? null;
}

/** Interpretacja jednej odpowiedzi — czysta funkcja (testy fixture). */
export function interpretViesResponse(
  vatNumber: string,
  httpStatus: number,
  body: unknown,
  checkedAt: string,
): Attempt {
  const record = body && typeof body === 'object' ? (body as Record<string, unknown>) : null;
  const code = record ? errorCodeOf(record) : null;

  if (httpStatus === 429) return { status: 'rate_limited', vatNumber };
  if (httpStatus < 200 || httpStatus >= 300) {
    if (code && classifyCode(code) === 'rate_limited') return { status: 'rate_limited', vatNumber };
    return {
      status: 'unavailable',
      vatNumber,
      reason: httpStatus >= 500 ? 'service_unavailable' : 'http_error',
    };
  }
  if (!record) return { status: 'unavailable', vatNumber, reason: 'unexpected_response' };

  if (record['actionSucceed'] === false || code) {
    return classifyCode(code) === 'rate_limited'
      ? { status: 'rate_limited', vatNumber }
      : { status: 'unavailable', vatNumber, reason: 'service_unavailable' };
  }

  const userError =
    typeof record['userError'] === 'string' ? record['userError'].trim().toUpperCase() : null;
  if (userError && userError !== 'VALID' && userError !== 'INVALID') {
    return classifyCode(userError) === 'rate_limited'
      ? { status: 'rate_limited', vatNumber }
      : { status: 'unavailable', vatNumber, reason: 'service_unavailable' };
  }

  const country = record['countryCode'];
  if (country !== undefined && country !== 'BE') {
    return { status: 'unavailable', vatNumber, reason: 'unexpected_response' };
  }

  const valid = record['valid'] ?? record['isValid'];
  const requestDate = cleanDate(record['requestDate']);
  if (valid === true && userError !== 'INVALID') {
    return { status: 'valid', vatNumber, name: cleanName(record['name']), requestDate, checkedAt };
  }
  if (valid === false && userError !== 'VALID') {
    return { status: 'invalid', vatNumber, requestDate, checkedAt };
  }
  return { status: 'unavailable', vatNumber, reason: 'unexpected_response' };
}

async function attemptOnce(
  vatNumber: string,
  opts: Required<Pick<ViesClientOptions, 'fetch' | 'timeoutMs' | 'now'>>,
): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs);
  try {
    const response = await opts.fetch(VIES_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ countryCode: 'BE', vatNumber }),
      signal: controller.signal,
      cache: 'no-store',
    });
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      if (controller.signal.aborted) return { status: 'unavailable', vatNumber, reason: 'timeout' };
      body = null;
    }
    return interpretViesResponse(vatNumber, response.status, body, opts.now().toISOString());
  } catch {
    return {
      status: 'unavailable',
      vatNumber,
      reason: controller.signal.aborted ? 'timeout' : 'network',
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sprawdza belgijski numer VAT w VIES. Nigdy nie rzuca — każdy problem to stan wyniku.
 */
export async function checkBelgianVatInVies(
  rawVat: string | null | undefined,
  options: ViesClientOptions = {},
): Promise<ViesCheckResult> {
  const parsed = parseBelgianVat(rawVat);
  if (!parsed.ok) return { status: 'format_invalid', reason: parsed.reason };

  const fetchImpl = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULTS.timeoutMs;
  const attempts = Math.max(1, Math.min(options.attempts ?? DEFAULTS.attempts, 5));
  const backoffBaseMs = options.backoffBaseMs ?? DEFAULTS.backoffBaseMs;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? (() => new Date());

  let last: Attempt = { status: 'unavailable', vatNumber: parsed.number, reason: 'network' };
  for (let i = 0; i < attempts; i += 1) {
    if (i > 0) await sleep(Math.round(random() * backoffBaseMs * 2 ** (i - 1)));
    last = await attemptOnce(parsed.number, { fetch: fetchImpl, timeoutMs, now });
    if (last.status === 'valid' || last.status === 'invalid') return last;
  }
  return last;
}
