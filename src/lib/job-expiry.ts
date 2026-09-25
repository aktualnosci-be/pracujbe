/**
 * Wygaszanie ofert po `expires_at` (#72) — jedno źródło reguły dla panelu pracodawcy.
 *
 * Status `expired` ustawia maintenance (`expire_due_jobs`, 0085), ale cron może się spóźnić.
 * Panel nie może wtedy liczyć ani pokazywać przeterminowanej oferty jako aktywnej, więc
 * wyznacza status efektywny tym samym predykatem co publiczne odczyty (0048):
 * oferta jest po terminie, gdy `expires_at` jest ustawione i `expires_at <= now`.
 */

/** Czy data ważności minęła (granica włącznie: `expires_at = now` to już po terminie). */
export function isPastExpiry(expiresAt: string | null | undefined, now: Date = new Date()): boolean {
  if (!expiresAt) return false;
  const time = Date.parse(expiresAt);
  if (Number.isNaN(time)) return false;
  return time <= now.getTime();
}

/** Status pokazywany w panelu: aktywna po terminie = `expired`, pozostałe bez zmian. */
export function effectiveJobStatus(
  status: string,
  expiresAt: string | null | undefined,
  now: Date = new Date(),
): string {
  return status === 'active' && isPastExpiry(expiresAt, now) ? 'expired' : status;
}

