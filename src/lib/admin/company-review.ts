/**
 * Reguły decyzji admina o firmie (#310) — wspólne dla dialogu (przeglądarka) i Server Action.
 * Te same limity egzekwuje baza (RPC `admin_set_company_status` i CHECK
 * `companies_status_reason_len`, migracja 0085).
 */

/** Maks. długość uzasadnienia decyzji. */
export const COMPANY_REASON_MAX = 1000;

/** Statusy, których ustawienie wymaga uzasadnienia (trafia do właściciela firmy i audytu). */
export const REASON_REQUIRED_STATUSES = ['rejected', 'suspended'] as const;

export function companyStatusNeedsReason(status: string): boolean {
  return (REASON_REQUIRED_STATUSES as readonly string[]).includes(status);
}

/** Błąd pola uzasadnienia albo null, gdy wartość jest poprawna dla danego statusu. */
export function companyReasonError(status: string, reason: string | null | undefined): 'required' | 'tooLong' | null {
  const trimmed = (reason ?? '').trim();
  if (companyStatusNeedsReason(status) && trimmed.length === 0) return 'required';
  if (trimmed.length > COMPANY_REASON_MAX) return 'tooLong';
  return null;
}
