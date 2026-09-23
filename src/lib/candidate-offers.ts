const NEW_PROPOSAL_STATUSES = new Set(['sent', 'viewed']);

export function isNewProposalStatus(status: string): boolean {
  return NEW_PROPOSAL_STATUSES.has(status);
}

export function canRespondToProposal(
  status: string,
  expiresAt: string | null,
  now: Date = new Date(),
): boolean {
  if (!isNewProposalStatus(status)) return false;
  if (expiresAt === null) return true;

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs > now.getTime();
}

/** Pokazuje upływ terminu bez zmieniania zapisanego statusu propozycji. */
export function proposalDisplayStatus(
  status: string,
  expiresAt: string | null,
  now: Date = new Date(),
): string {
  if (!isNewProposalStatus(status) || expiresAt === null) return status;

  const expiresAtMs = Date.parse(expiresAt);
  return Number.isFinite(expiresAtMs) && expiresAtMs <= now.getTime()
    ? 'expired'
    : status;
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

/** Kotwica karty propozycji na `/candidate/propozycje` — baner prowadzi tam, gdzie można odpowiedzieć (#324). */
export function proposalAnchorId(offerId: string): string {
  return `offer-${offerId}`;
}

export function proposalAnchorHref(offerId: string): string {
  return `/candidate/propozycje#${proposalAnchorId(offerId)}`;
}
