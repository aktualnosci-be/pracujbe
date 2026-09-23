import { beforeEach, describe, expect, it, vi } from 'vitest';

import { loadMoreProposals } from '@/lib/actions/candidate-proposals';
import { getMyOffersPage } from '@/lib/data/candidate';

vi.mock('@/lib/data/candidate', () => ({ getMyOffersPage: vi.fn() }));

const cursor = {
  createdAt: '2026-09-20T09:00:00+00:00',
  id: 'bbbbbbbb-bbbb-4bbb-8bbb-000000000012',
};

beforeEach(() => vi.clearAllMocks());

describe('loadMoreProposals', () => {
  it('przyjmuje poprawny kursor i czyta pod sesją serwera', async () => {
    vi.mocked(getMyOffersPage).mockResolvedValue({ items: [], nextCursor: null });
    expect(await loadMoreProposals('nl', cursor)).toEqual({ status: 'ready', page: { items: [], nextCursor: null } });
    expect(getMyOffersPage).toHaveBeenCalledWith('nl', cursor);
  });

  it.each([
    ['nieobsługiwany język', 'de', cursor],
    ['wstrzyknięty filtr', 'pl', { ...cursor, id: 'a,or(candidate_id.neq.own)' }],
    ['niepoprawna data', 'pl', { ...cursor, createdAt: 'yesterday' }],
    ['wstrzyknięcie przez cudzysłów', 'pl', { ...cursor, createdAt: '2026-09-20T09:00:00+00:00"),candidate_id.neq.own' }],
    ['brak kursora', 'pl', null],
  ])('odrzuca: %s, zanim zapyta bazę', async (_reason, locale, value) => {
    expect(await loadMoreProposals(locale, value)).toEqual({ status: 'error' });
    expect(getMyOffersPage).not.toHaveBeenCalled();
  });

  it('ukrywa szczegóły błędu przed klientem', async () => {
    vi.mocked(getMyOffersPage).mockRejectedValue(new Error('database details'));
    expect(await loadMoreProposals('pl', cursor)).toEqual({ status: 'error' });
  });
});
