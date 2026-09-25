/**
 * Lista operacji Better Auth wystawionych przez `/api/auth/[...all]` (#24). Rejestracja, logowanie,
 * reset i weryfikacja idą przez Server Actions (limiter, Turnstile, Zod, rola z profilu), więc ich
 * endpointy SDK NIE są publiczne. Zmiana listy wymaga przeglądu bezpieczeństwa i testu
 * `tests/unit/auth-http-route.test.ts`.
 */

/** Ścieżki SDK (po `/api/auth`) dopuszczone per metoda. Wszystko inne → 404. */
export const ALLOWED_AUTH_ENDPOINTS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  GET: Object.freeze(['/get-session']),
});

export const AUTH_BASE_PATH = '/api/auth';

/** Dokładne dopasowanie ścieżki (bez prefiksów, ukośników końcowych ani kodowania). */
export function isAllowedAuthRequest(method: string, pathname: string): boolean {
  if (!pathname.startsWith(`${AUTH_BASE_PATH}/`)) return false;
  const endpoint = pathname.slice(AUTH_BASE_PATH.length);
  return (ALLOWED_AUTH_ENDPOINTS[method] ?? []).includes(endpoint);
}

