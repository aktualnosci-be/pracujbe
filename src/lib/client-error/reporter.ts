'use client';

import { captureError, setErrorReporter, type ErrorReport } from '@/lib/error-report';

/**
 * Reporter błędów w przeglądarce (#502). Wysyła do `POST /api/client-error` tej witryny
 * WYŁĄCZNIE: kod błędu, ścieżkę strony (bez query i fragmentu — serwer i tak ją redaguje)
 * i wydanie buildu. Nigdy treści wyjątku ani stack trace (mogą zawierać dane kandydata),
 * bez cookies (`credentials: 'omit'`) i bez identyfikatorów — dlatego nie wymaga zgody.
 *
 * Deduplikacja w karcie: para (kod, ścieżka) najwyżej raz, łącznie najwyżej
 * {@link CLIENT_ERROR_MAX_PER_TAB} zgłoszeń na załadowanie karty. Czy coś trafia dalej,
 * decyduje serwer (bez `ERROR_WEBHOOK_URL` endpoint odpowiada 204 i nic nie wysyła).
 */
export const CLIENT_ERROR_ENDPOINT = '/api/client-error';
export const CLIENT_ERROR_MAX_PER_TAB = 10;

export interface ClientErrorBody {
  code: string;
  route: string;
  release?: string;
}

export interface ClientReporterDeps {
  fetch?: typeof fetch;
  pathname?: () => string;
  release?: string;
}

/** Ścieżka bez query i fragmentu (`location.pathname` ich nie ma; obcinamy na wszelki wypadek). */
export function clientRoute(pathname: string): string {
  const path = (pathname.split(/[?#]/, 1)[0] ?? '').slice(0, 511);
  return path.startsWith('/') ? path : `/${path}`;
}

export function createClientErrorReporter(deps: ClientReporterDeps = {}): (report: ErrorReport) => void {
  const doFetch = deps.fetch ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const pathname = deps.pathname ?? (() => window.location.pathname);
  const release = deps.release ?? process.env.NEXT_PUBLIC_APP_VERSION;
  const seen = new Set<string>();

  return (report) => {
    let route = '/';
    try {
      route = clientRoute(pathname());
    } catch {
      // brak `location` — zostaje `/`
    }
    const key = `${report.code}|${route}`;
    if (seen.has(key) || seen.size >= CLIENT_ERROR_MAX_PER_TAB) return;
    seen.add(key);
    // Tylko te trzy pola — nigdy `message`/`stack` wyjątku.
    const body: ClientErrorBody = { code: report.code, route };
    if (release) body.release = release;
    try {
      void doFetch(CLIENT_ERROR_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'omit',
        keepalive: true,
        cache: 'no-store',
      }).catch(() => undefined);
    } catch {
      // Zgłoszenie błędu nigdy nie psuje strony.
    }
  };
}

/** Błąd skryptu z innej witryny (rozszerzenia, „Script error.”) nie jest naszym błędem. */
export function isOwnScriptError(event: Pick<ErrorEvent, 'filename'>, origin: string): boolean {
  return typeof event.filename === 'string' && event.filename.startsWith(`${origin}/`);
}

let installed = false;

/** Rejestruje reporter i nasłuch `error`/`unhandledrejection` (idempotentnie). */
export function installClientErrorReporter(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  setErrorReporter(createClientErrorReporter());
  window.addEventListener('error', (event) => {
    if (!isOwnScriptError(event, window.location.origin)) return;
    captureError(event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    captureError(event.reason);
  });
}
