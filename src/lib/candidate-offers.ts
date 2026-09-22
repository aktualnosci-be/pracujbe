const NEW_PROPOSAL_STATUSES = new Set(['sent', 'viewed']);

export function isNewProposalStatus(status: string): boolean {
  return NEW_PROPOSAL_STATUSES.has(status);
}

/**
 * Wybiera aktywną propozycję tak samo jak zapytanie bazodanowe: po `sent_at`, a przy remisie
 * po stabilnym identyfikatorze. Przydaje się wyłącznie ścieżce demonstracyjnej i testom domeny.
 */
export function findLatestActiveProposal<
  T extends {
    id: string;
    status: string;
    sentAt: string | null;
    expiresAt: string | null;
  },
>(
  offers: readonly T[],
  now: Date = new Date(),
): T | null {
  const nowMs = now.getTime();

  return (
    offers
      .filter((offer) => {
        const sentAtMs = offer.sentAt ? Date.parse(offer.sentAt) : Number.NaN;
        const expiresAtMs = offer.expiresAt ? Date.parse(offer.expiresAt) : null;
        return (
          isNewProposalStatus(offer.status) &&
          Number.isFinite(sentAtMs) &&
          (expiresAtMs === null || (Number.isFinite(expiresAtMs) && expiresAtMs > nowMs))
        );
      })
      .sort((a, b) => {
        const bySentAt = Date.parse(b.sentAt!) - Date.parse(a.sentAt!);
        return bySentAt || b.id.localeCompare(a.id);
      })[0] ?? null
  );
}
