/**
 * Centralny system błędów Pracuj.be.
 *
 * Zasada (Invariant #8): użytkownik NIGDY nie widzi technikaliów (stack trace / SQL /
 * surowej odpowiedzi dostawcy). Kod rzuca `AppError` z ustabilizowanym kodem, a warstwa UI
 * pokazuje komunikat z klucza tłumaczenia (`errors.<CODE>`).
 */

/**
 * Ustabilizowane kody błędów aplikacji. Wartość = sam kod (stabilny identyfikator).
 * `as const` sprawia, że `ErrorCode` jest unią literałów, a nie zwykłym `string`.
 */
export const ErrorCodes = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  JOB_NOT_ACTIVE: 'JOB_NOT_ACTIVE',
  APPLICATION_ALREADY_EXISTS: 'APPLICATION_ALREADY_EXISTS',
  OFFER_ALREADY_EXISTS: 'OFFER_ALREADY_EXISTS',
  OFFER_SEND_FAILED: 'OFFER_SEND_FAILED',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  COMPANY_NOT_VERIFIED: 'COMPANY_NOT_VERIFIED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/**
 * Mapuje kod błędu na klucz i18n. Klucze muszą istnieć w namespace `errors`
 * we wszystkich plikach `src/messages/*.json` (pl/nl/fr/en).
 */
export function toUserMessageKey(code: ErrorCode): string {
  return `errors.${code}`;
}

export interface AppErrorOptions {
  /** Nadpisanie klucza tłumaczenia komunikatu dla użytkownika. Domyślnie `errors.<code>`. */
  userMessageKey?: string;
  /** Dodatkowy kontekst (do logów/Sentry) — NIGDY nie pokazywany użytkownikowi. */
  context?: Record<string, unknown>;
  /** Oryginalny błąd (zachowany jako `cause`). */
  cause?: unknown;
}

/**
 * Błąd domenowy aplikacji. Niesie stabilny `code` oraz `userMessageKey` (klucz i18n).
 * Techniczne szczegóły trzymaj w `context`/`cause` — nie w komunikacie dla użytkownika.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly userMessageKey: string;
  readonly context?: Record<string, unknown>;

  constructor(code: ErrorCode, opts?: AppErrorOptions) {
    super(code, opts?.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'AppError';
    this.code = code;
    this.userMessageKey = opts?.userMessageKey ?? toUserMessageKey(code);
    if (opts?.context !== undefined) {
      this.context = opts.context;
    }
    // Zapewnia poprawny łańcuch prototypów (instanceof) niezależnie od targetu kompilacji.
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

/** Type guard: czy wartość jest instancją `AppError`. */
export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}
