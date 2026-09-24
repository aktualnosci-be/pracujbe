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
  AUTH_EMAIL_NOT_CONFIRMED: 'AUTH_EMAIL_NOT_CONFIRMED',
  AUTH_LINK_INVALID: 'AUTH_LINK_INVALID',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  JOB_NOT_ACTIVE: 'JOB_NOT_ACTIVE',
  APPLICATION_ALREADY_EXISTS: 'APPLICATION_ALREADY_EXISTS',
  SCREENING_ANSWER_REQUIRED: 'SCREENING_ANSWER_REQUIRED',
  OFFER_ALREADY_EXISTS: 'OFFER_ALREADY_EXISTS',
  OFFER_SEND_FAILED: 'OFFER_SEND_FAILED',
  EMAIL_DELIVERY_FAILED: 'EMAIL_DELIVERY_FAILED',
  RATE_LIMITED: 'RATE_LIMITED',
  BOT_CHECK_FAILED: 'BOT_CHECK_FAILED',
  BOT_CHECK_UNAVAILABLE: 'BOT_CHECK_UNAVAILABLE',
  COMPANY_NOT_VERIFIED: 'COMPANY_NOT_VERIFIED',
  ONBOARDING_INCOMPLETE: 'ONBOARDING_INCOMPLETE',
  JOB_NOT_DRAFT: 'JOB_NOT_DRAFT',
  JOB_NOT_EDITABLE: 'JOB_NOT_EDITABLE',
  JOB_EDIT_CONFLICT: 'JOB_EDIT_CONFLICT',
  JOB_EXPIRED: 'JOB_EXPIRED',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  STALE_STATE: 'STALE_STATE',
  MODERATION_LOCKED: 'MODERATION_LOCKED',
  BILLING_UNAVAILABLE: 'BILLING_UNAVAILABLE',
  CHECKOUT_IN_PROGRESS: 'CHECKOUT_IN_PROGRESS',
  ENTITLEMENT_LIMIT: 'ENTITLEMENT_LIMIT',
  DEMO_UNAVAILABLE: 'DEMO_UNAVAILABLE',
  SAVED_SEARCH_LIMIT_REACHED: 'SAVED_SEARCH_LIMIT_REACHED',
  JOB_IMPORT_INVALID_FILE: 'JOB_IMPORT_INVALID_FILE',
  JOB_IMPORT_INVALID_URL: 'JOB_IMPORT_INVALID_URL',
  JOB_IMPORT_FETCH_FAILED: 'JOB_IMPORT_FETCH_FAILED',
  JOB_IMPORT_NOT_A_LISTING: 'JOB_IMPORT_NOT_A_LISTING',
  JOB_IMPORT_FAILED: 'JOB_IMPORT_FAILED',
  JOB_IMPORT_SENSITIVE_DATA: 'JOB_IMPORT_SENSITIVE_DATA',
  GUEST_APPLY_UNAVAILABLE: 'GUEST_APPLY_UNAVAILABLE',
  EMAIL_NOT_VERIFIED: 'EMAIL_NOT_VERIFIED',
  CLAIM_EXPIRED: 'CLAIM_EXPIRED',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = keyof typeof ErrorCodes;

/**
 * Mapowanie kodu błędu (SCREAMING_SNAKE_CASE) na sufiks klucza i18n (camelCase).
 * Klucze muszą istnieć w namespace `errors` we WSZYSTKICH plikach `src/messages/*.json`
 * (pl/nl/fr/en) — patrz test `tests/unit/error-keys.test.ts`.
 *
 * `Record<ErrorCode, string>` gwarantuje, że każdy nowy kod błędu wymusi tu wpis
 * (błąd kompilacji, jeśli brak).
 */
const ERROR_MESSAGE_KEYS: Record<ErrorCode, string> = {
  AUTH_INVALID_CREDENTIALS: 'authInvalidCredentials',
  AUTH_EMAIL_NOT_CONFIRMED: 'authEmailNotConfirmed',
  AUTH_LINK_INVALID: 'authLinkInvalid',
  PERMISSION_DENIED: 'permissionDenied',
  VALIDATION_FAILED: 'validationFailed',
  JOB_NOT_ACTIVE: 'jobNotActive',
  APPLICATION_ALREADY_EXISTS: 'applicationAlreadyExists',
  SCREENING_ANSWER_REQUIRED: 'screeningAnswerRequired',
  OFFER_ALREADY_EXISTS: 'offerAlreadyExists',
  OFFER_SEND_FAILED: 'offerSendFailed',
  EMAIL_DELIVERY_FAILED: 'emailDeliveryFailed',
  RATE_LIMITED: 'rateLimited',
  BOT_CHECK_FAILED: 'botCheckFailed',
  BOT_CHECK_UNAVAILABLE: 'botCheckUnavailable',
  COMPANY_NOT_VERIFIED: 'companyNotVerified',
  ONBOARDING_INCOMPLETE: 'onboardingIncomplete',
  JOB_NOT_DRAFT: 'jobNotDraft',
  JOB_NOT_EDITABLE: 'jobNotEditable',
  JOB_EDIT_CONFLICT: 'jobEditConflict',
  JOB_EXPIRED: 'jobExpired',
  INVALID_TRANSITION: 'invalidTransition',
  STALE_STATE: 'staleState',
  MODERATION_LOCKED: 'moderationLocked',
  BILLING_UNAVAILABLE: 'billingDisabled',
  CHECKOUT_IN_PROGRESS: 'checkoutInProgress',
  ENTITLEMENT_LIMIT: 'activeJobLimit',
  DEMO_UNAVAILABLE: 'demoUnavailable',
  SAVED_SEARCH_LIMIT_REACHED: 'savedSearchLimitReached',
  JOB_IMPORT_INVALID_FILE: 'jobImportInvalidFile',
  JOB_IMPORT_INVALID_URL: 'jobImportInvalidUrl',
  JOB_IMPORT_FETCH_FAILED: 'jobImportFetchFailed',
  JOB_IMPORT_NOT_A_LISTING: 'jobImportNotAListing',
  JOB_IMPORT_FAILED: 'jobImportFailed',
  JOB_IMPORT_SENSITIVE_DATA: 'jobImportSensitiveData',
  GUEST_APPLY_UNAVAILABLE: 'guestApplyUnavailable',
  EMAIL_NOT_VERIFIED: 'emailNotVerified',
  CLAIM_EXPIRED: 'claimExpired',
  NOT_FOUND: 'notFound',
  INTERNAL: 'internal',
};

/**
 * Mapuje kod błędu na klucz i18n w formacie `errors.<camelCase>`.
 * Zwracany klucz odpowiada strukturze plików tłumaczeń (np. `errors.authInvalidCredentials`),
 * a NIE surowemu kodowi (`errors.AUTH_INVALID_CREDENTIALS`).
 */
export function toUserMessageKey(code: ErrorCode): string {
  return `errors.${ERROR_MESSAGE_KEYS[code]}`;
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
