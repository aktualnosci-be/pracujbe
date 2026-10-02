/**
 * Powrót po logowaniu do strony panelu (#1090, AUTH-07).
 *
 * Guardy paneli (`/candidate`, `/employer`, `/admin`) są layoutami — Next nie podaje im ścieżki
 * żądania. Middleware przekazuje ją w nagłówku żądania `PANEL_RETURN_PATH_HEADER` (zawsze
 * nadpisywanym: wartość od klienta jest usuwana), a guard bez sesji kieruje na
 * `/logowanie?next=<ścieżka>`. Wartość i tak przechodzi przez `safeNextPath` przy odczycie
 * i w akcji logowania (tylko ścieżka w obrębie serwisu z prefiksem języka).
 *
 * Moduł bez zależności serwerowych — importuje go middleware (Edge).
 */
export const PANEL_RETURN_PATH_HEADER = 'x-pracujbe-return-path';

const PANEL_PATH_RE = /^\/[a-z]{2}\/(?:candidate|employer|admin)(?:\/|$)/;

/** Ścieżka + query strony panelu do zapamiętania albo `null` dla innych tras. */
export function panelReturnPath(pathname: string, search: string): string | null {
  if (!PANEL_PATH_RE.test(pathname)) return null;
  return `${pathname}${search}`;
}
