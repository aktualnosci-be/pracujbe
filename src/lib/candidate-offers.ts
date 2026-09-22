const NEW_PROPOSAL_STATUSES = new Set(['sent', 'viewed']);

export function isNewProposalStatus(status: string): boolean {
  return NEW_PROPOSAL_STATUSES.has(status);
}

/** Zwraca najnowszą propozycję, na którą kandydat może jeszcze odpowiedzieć. */
export function findNewProposal<T extends { status: string }>(
  offers: readonly T[],
): T | null {
  return offers.find((offer) => isNewProposalStatus(offer.status)) ?? null;
}
