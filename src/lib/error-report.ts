import { isAppError } from '@/lib/errors';

/**
 * Zgłaszanie błędów (#571). Jedyne wyjście to webhook Discorda (`ERROR_WEBHOOK_URL`,
 * `src/lib/error-webhook`), rejestrowany w `src/instrumentation.ts` wyłącznie w runtime
 * serwera (Node/Edge). Ten moduł jest izomorficzny i nie zawiera kodu wysyłki. W przeglądarce
 * reporter rejestruje `src/lib/client-error/reporter.ts` — wysyła sam kod, ścieżkę i wydanie
 * do `POST /api/client-error` tej witryny (adres webhooka nigdy nie trafia do bundla klienta).
 * Błąd z `digest` to błąd serwera, który zgłosił już `onRequestError` — przeglądarka go pomija.
 *
 * Zachowuje wyłącznie stabilny kod błędu. Surowy wyjątek, `cause` i kontekst wywołania mogą
 * zawierać dane kandydata, więc nie są przekazywane dalej (#502).
 */
export interface ErrorReport {
  /** Kod z `ErrorCodes` (`INTERNAL` dla błędów spoza `AppError`). */
  code: string;
  /** Szablon trasy albo ścieżka — reporter i tak ją redaguje (bez query i fragmentu). */
  route?: string;
  /** Źródło: `client` = zgłoszenie z przeglądarki przez `/api/client-error`. Domyślnie serwer. */
  source?: 'server' | 'client';
  /** Wydanie zgłoszone przez przeglądarkę (karta może działać na starszym buildzie). */
  release?: string;
}

export type ErrorReporter = (report: ErrorReport) => void;

const REPORTER_KEY = Symbol.for('pracujbe.errorReporter');
type ReporterHost = { [REPORTER_KEY]?: ErrorReporter | null };

/** Rejestruje reporter procesu (instrumentation) albo go zdejmuje (`null`, testy). */
export function setErrorReporter(reporter: ErrorReporter | null): void {
  (globalThis as ReporterHost)[REPORTER_KEY] = reporter;
}

export function errorCodeOf(e: unknown): string {
  return isAppError(e) ? e.code : 'INTERNAL';
}

function hasDigest(e: unknown, context?: Record<string, unknown>): boolean {
  const own = typeof e === 'object' && e !== null ? (e as { digest?: unknown }).digest : undefined;
  return (typeof own === 'string' && own !== '') || (typeof context?.digest === 'string' && context.digest !== '');
}

export function captureError(e: unknown, _context?: Record<string, unknown>): void {
  const reporter = (globalThis as ReporterHost)[REPORTER_KEY];
  if (!reporter) return;
  // Przeglądarka: błąd z `digest` pochodzi z serwera i został już zgłoszony (`onRequestError`).
  if (typeof window !== 'undefined' && hasDigest(e, _context)) return;
  try {
    // Oryginalny wyjątek, jego `cause` i kontekst wywołania mogą zawierać dane kandydata.
    reporter({ code: errorCodeOf(e) });
  } catch {
    // Zgłoszenie błędu nigdy nie psuje obsługi żądania.
  }
}
