/**
 * Reguły zdjęcia blokady adresu e-mail (#44) — wspólne dla dialogu (przeglądarka) i Server
 * Action. Te same limity egzekwuje baza (RPC `admin_lift_email_suppression` i CHECK
 * `email_suppressions_lift`, migracja 0098).
 */

/** Maks. długość uzasadnienia zdjęcia blokady. */
export const EMAIL_LIFT_REASON_MAX = 1000;

/** Błąd pola uzasadnienia albo null, gdy wartość jest poprawna. */
export function emailLiftReasonError(reason: string | null | undefined): 'required' | 'tooLong' | null {
  const trimmed = (reason ?? '').trim();
  if (trimmed.length === 0) return 'required';
  if (trimmed.length > EMAIL_LIFT_REASON_MAX) return 'tooLong';
  return null;
}
