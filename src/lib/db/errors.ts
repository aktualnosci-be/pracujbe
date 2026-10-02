import 'server-only';

import { captureError } from '@/lib/error-report';

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

/**
 * Nieoczekiwany błąd bazy do kanału błędów (#1068). Akcje mapują komunikat bazy na kod
 * użytkowy; gdy wynik to `INTERNAL` (SQLSTATE spoza znanej listy — np. rozjazd schematu po
 * nieudanym wdrożeniu, przeciążenie bazy), użytkownik widzi ogólny komunikat, a operator
 * dostaje wpis z obszarem i kodem SQLSTATE. Komunikat bazy (może zawierać wiersz z danymi)
 * NIE jest przekazywany. Zwraca `mapped` bez zmian, więc owija się wprost wokół mapowania:
 * `reportUnmappedDbError(error, 'company.update', mapPgError(databaseErrorMessage(error)))`.
 */
export function reportUnmappedDbError<T extends string>(error: unknown, area: string, mapped: T): T {
  if (mapped === 'INTERNAL' && isDatabaseError(error)) {
    captureError(error, { area, sqlstate: error.code });
  }
  return mapped;
}

/**
 * Wyjątek akcji do kanału błędów (#1068): błąd bazy z SQLSTATE w kontekście (bez komunikatu
 * bazy), każdy inny wyjątek (sieć, konfiguracja) z samym obszarem. Dla ścieżek, które po
 * dopasowaniu znanych kodów biznesowych kończą się INTERNAL.
 */
export function captureActionError(error: unknown, area: string): void {
  captureError(error, isDatabaseError(error) ? { area, sqlstate: error.code } : { area });
}
