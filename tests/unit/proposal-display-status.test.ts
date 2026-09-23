import { describe, expect, it } from 'vitest';

import { canRespondToProposal, proposalDisplayStatus } from '@/lib/candidate-offers';

const now = new Date('2026-09-23T00:00:00.000Z');

describe('widoczny status propozycji', () => {
  it.each(['sent', 'viewed'])('pokazuje %s jako wygasłą po upływie terminu', (status) => {
    const expiresAt = '2026-09-22T23:59:59.000Z';
    expect(proposalDisplayStatus(status, expiresAt, now)).toBe('expired');
    expect(canRespondToProposal(status, expiresAt, now)).toBe(false);
  });

  it('zachowuje status i odpowiedź przed terminem', () => {
    const expiresAt = '2026-09-23T00:00:01.000Z';
    expect(proposalDisplayStatus('sent', expiresAt, now)).toBe('sent');
    expect(canRespondToProposal('sent', expiresAt, now)).toBe(true);
  });

  it('nie zmienia statusów zakończonych ani propozycji bez terminu', () => {
    expect(proposalDisplayStatus('accepted', '2026-09-22T00:00:00.000Z', now)).toBe('accepted');
    expect(proposalDisplayStatus('viewed', null, now)).toBe('viewed');
  });
});
