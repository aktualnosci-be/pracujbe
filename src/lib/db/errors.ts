import 'server-only';

/**
 * Błąd zgłoszony przez PostgreSQL (pg.DatabaseError): ma SQLSTATE w `code`. Zastępuje
 * pole `error` odpowiedzi PostgREST — akcje mapują `message`/`code` na kody użytkowe
 * (Invariant #8) tak jak dotąd, a wyjątki spoza bazy (sieć, konfiguracja) trafiają do kanału błędów.
 */
export interface DatabaseErrorLike {
  message: string;
  code: string;
}

export function isDatabaseError(error: unknown): error is DatabaseErrorLike {
  if (typeof error !== 'object' || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) && typeof message === 'string';
}

/** Komunikat błędu bazy albo pusty string (dla dopasowań `includes('…')`). */
export function databaseErrorMessage(error: unknown): string {
  return isDatabaseError(error) ? error.message : '';
}
