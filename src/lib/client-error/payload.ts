import 'server-only';

import { safeErrorCode, safeRoute } from '@/lib/error-webhook/message';

/**
 * Walidacja zgłoszenia błędu z przeglądarki (`POST /api/client-error`, #502).
 *
 * Przyjmujemy WYŁĄCZNIE trzy pola: `code` (kod z `ErrorCodes`, inaczej `INTERNAL`), `route`
 * (ścieżka — redagowana przez `safeRoute`: bez query, fragmentu i segmentów wyglądających na
 * token/dane osobowe) i `release` (wydanie buildu). Każde inne pole — w szczególności
 * `message`/`stack`, które mogą zawierać dane kandydata — odrzuca całe zgłoszenie (`null`),
 * więc nic z takiego żądania nie trafia do kanału błędów.
 */
export interface ClientErrorPayload {
  code: string;
  route: string;
  release?: string;
}

const ALLOWED_KEYS = new Set(['code', 'route', 'release']);
const MAX_CODE = 64;
const MAX_ROUTE = 512;
const RELEASE_RE = /^[0-9A-Za-z._+-]{1,64}$/;

export function parseClientErrorPayload(input: unknown): ClientErrorPayload | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) return null;
  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !ALLOWED_KEYS.has(key))) return null;

  const { code, route, release } = record;
  if (typeof code !== 'string' || code.length === 0 || code.length > MAX_CODE) return null;
  if (route !== undefined && (typeof route !== 'string' || route.length > MAX_ROUTE)) return null;
  if (release !== undefined && typeof release !== 'string') return null;

  const payload: ClientErrorPayload = {
    code: safeErrorCode(code),
    route: safeRoute(typeof route === 'string' ? route : undefined),
  };
  if (typeof release === 'string' && RELEASE_RE.test(release)) payload.release = release;
  return payload;
}
