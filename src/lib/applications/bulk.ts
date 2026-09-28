/**
 * Stałe akcji zbiorczej i limitów zmiany statusu zgłoszeń (LIM17-01, 0940) — współdzielone
 * przez Server Action (`src/lib/actions/applications.ts`) i UI panelu pracodawcy.
 */

/** Najwyżej tyle zgłoszeń w jednej akcji zbiorczej (ten sam limit w `bulk_transition_applications`). */
export const BULK_TRANSITION_MAX = 50;

/**
 * Każde przejście może wysłać e-mail do kandydata (także do gościa bez linku wypisania).
 * Limit per konto i per konto × zgłoszenie; akcja zbiorcza ma własny budżet operacji.
 * W bazie dodatkowo scalanie i sufit e-maili (`application_status_email_gate`).
 */
export const TRANSITION_RATE_LIMITS = {
  perUser: { max: 120, windowSeconds: 3600 },
  perApplication: { max: 20, windowSeconds: 3600 },
  bulkPerUser: { max: 20, windowSeconds: 3600 },
} as const;

export const BULK_TRANSITION_OUTCOMES = [
  'changed',
  'unchanged',
  'invalid_transition',
  'not_found',
  'permission_denied',
  'error',
] as const;
export type BulkTransitionOutcome = (typeof BULK_TRANSITION_OUTCOMES)[number];

/** Statusy do filtra listy zgłoszeń (`?status=`) — wszystkie poza szkicem. */
export const APPLICATION_FILTER_STATUSES = [
  'submitted',
  'viewed',
  'shortlisted',
  'interview',
  'offer_sent',
  'offer_accepted',
  'offer_declined',
  'rejected',
  'withdrawn',
  'hired',
] as const;
export type ApplicationFilterStatus = (typeof APPLICATION_FILTER_STATUSES)[number];

export function parseApplicationStatusFilter(value: unknown): ApplicationFilterStatus | null {
  return typeof value === 'string' && (APPLICATION_FILTER_STATUSES as readonly string[]).includes(value)
    ? (value as ApplicationFilterStatus)
    : null;
}

/** Raport operacji zbiorczej: liczba zgłoszeń w każdym wyniku (kolejność stała). */
export function summarizeBulkOutcomes(
  results: readonly { outcome: BulkTransitionOutcome }[],
): Record<BulkTransitionOutcome, number> {
  const summary = Object.fromEntries(BULK_TRANSITION_OUTCOMES.map((o) => [o, 0])) as Record<
    BulkTransitionOutcome,
    number
  >;
  for (const r of results) summary[r.outcome] += 1;
  return summary;
}
