import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getActiveCompany } from '@/lib/company-context';
import { getEmployerApplicationHistoryPage } from '@/lib/data/employer';
import { loadMoreApplicationHistory } from '@/lib/actions/employer-application-history';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';

/**
 * #604 — szczegół zgłoszenia pracodawcy nie ukrywał historii statusów po pierwszych 50
 * zdarzeniach: loader i server action stronicują kursorem (`created_at` + `id`, rosnąco)
 * zamiast sztywnego `LIMIT 50` bez sygnału i bez dalszej nawigacji.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = '11111111-1111-4111-8111-111111111111';
const APP_ID = '22222222-2222-4222-8222-222222222222';

function historyRow(index: number) {
  return {
    id: `33333333-3333-4333-8333-${String(index).padStart(12, '0')}`,
    to_status: 'viewed',
    created_at: `2026-09-01T00:00:${String(index).padStart(2, '0')}Z`,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1',
    activeStatus: 'verified',
    activeName: 'Firma',
    activeRole: 'owner',
    companies: [],
  });
});

describe('getEmployerApplicationHistoryPage (#604)', () => {
  it('pierwsza strona ma 50 wpisów i kursor; druga niesie resztę bez kursora', async () => {
    fakeDb.rows('employer.application-history-owner', [{ x: 1 }]);
    const rows = Array.from({ length: 51 }, (_, i) => historyRow(i));
    fakeDb.rows('employer.application-history-page', ({ values }) =>
      values[1] === null ? rows : rows.slice(50),
    );

    const page1 = await getEmployerApplicationHistoryPage(APP_ID);
    expect(page1.items).toHaveLength(50);
    expect(page1.items[0]).toEqual({ id: historyRow(0).id, toStatus: 'viewed', at: historyRow(0).created_at });
    expect(page1.nextCursor).toEqual({ createdAt: historyRow(49).created_at, id: historyRow(49).id });

    const page2 = await getEmployerApplicationHistoryPage(APP_ID, page1.nextCursor);
    expect(page2.items).toHaveLength(1);
    expect(page2.items[0]?.id).toBe(historyRow(50).id);
    expect(page2.nextCursor).toBeNull();

    const calls = fakeDb.callsTo('employer.application-history-page');
    expect(calls[0]?.values).toEqual([APP_ID, null, null, 51]);
    expect(calls[1]?.values).toEqual([APP_ID, historyRow(49).created_at, historyRow(49).id, 51]);
  });

  it('cudza/usunięta aplikacja (poza aktywną firmą) → pusta strona, historia nieodczytana', async () => {
    fakeDb.rows('employer.application-history-owner', []);
    expect(await getEmployerApplicationHistoryPage(APP_ID)).toEqual({ items: [], nextCursor: null });
    expect(fakeDb.callsTo('employer.application-history-page')).toHaveLength(0);
  });

  it('zły identyfikator aplikacji → pusta strona bez zapytań do bazy', async () => {
    expect(await getEmployerApplicationHistoryPage('nie-uuid')).toEqual({ items: [], nextCursor: null });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('server action loadMoreApplicationHistory (#604)', () => {
  it('odrzuca zły identyfikator aplikacji i zniekształcony kursor przed odczytem', async () => {
    expect(
      await loadMoreApplicationHistory('nie-uuid', { createdAt: '2026-09-01T00:00:00Z', id: APP_ID }),
    ).toEqual({ status: 'error' });
    expect(await loadMoreApplicationHistory(APP_ID, { createdAt: 'zla-data', id: APP_ID })).toEqual({
      status: 'error',
    });
    expect(await loadMoreApplicationHistory(APP_ID, null)).toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('poprawny kursor → kolejna strona z bazy pod bieżącą sesją', async () => {
    fakeDb.rows('employer.application-history-owner', [{ x: 1 }]);
    fakeDb.rows('employer.application-history-page', []);
    const result = await loadMoreApplicationHistory(APP_ID, {
      createdAt: '2026-09-01T00:00:00Z',
      id: APP_ID,
    });
    expect(result).toEqual({ status: 'ready', page: { items: [], nextCursor: null } });
  });
});
