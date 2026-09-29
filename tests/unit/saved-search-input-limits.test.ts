import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #1108 — „Zapisz wyszukiwanie” przyjmuje to, co lista ofert normalnie obsługuje:
 * słowo kluczowe/miasto dłuższe niż 100 znaków (lista ucina `left(…, 100)`), limity liczone
 * w punktach kodowych jak w bazie, znak NUL odrzucony przed bazą.
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { saveSearchAction } from '@/lib/actions/saved-searches';
import {
  parseJobListQuery,
  savedSearchFiltersFromQuery,
  savedSearchQueryString,
} from '@/lib/job-list-query';

const USER = '11111111-1111-4111-8111-111111111111';

function payload(flat: Record<string, string>) {
  const query = parseJobListQuery(flat, 'pl');
  return {
    name: 'Moje wyszukiwanie',
    locale: 'pl',
    filters: savedSearchFiltersFromQuery(query),
    query: savedSearchQueryString(query),
  };
}

beforeEach(() => {
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  fakeDb.rpc('save_saved_search', () => [{ saved_search_id: 'id-1', created: true }]);
});

describe('zapis wyszukiwania ze słowem kluczowym dłuższym niż 100 znaków', () => {
  it('filtry są ucięte do 100 znaków i akcja zapisuje wyszukiwanie', async () => {
    const long = `magazynier ${'x'.repeat(200)}`;
    const input = payload({ keyword: long, city: 'y'.repeat(150) });
    expect(input.filters.keyword).toHaveLength(100);
    expect(input.filters.city).toHaveLength(100);
    expect(await saveSearchAction(input)).toEqual({ ok: true, id: 'id-1', created: true });
    expect(fakeDb.callsTo('save_saved_search')).toHaveLength(1);
  });

  it('kontrola ujemna: nieucięte słowo (stan sprzed naprawy) jest odrzucane', async () => {
    const input = payload({ keyword: 'magazynier' });
    const res = await saveSearchAction({ ...input, filters: { keyword: 'x'.repeat(101) } });
    expect(res).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('ucięcie po punktach kodowych (nie rozcina pary zastępczej) i bez końcowej spacji', () => {
    const emoji = '😀'.repeat(150);
    const filters = payload({ keyword: emoji }).filters;
    expect(Array.from(filters.keyword ?? '')).toHaveLength(100);
    const spaced = payload({ keyword: `${'a'.repeat(99)} bbb` }).filters;
    expect(spaced.keyword).toBe('a'.repeat(99));
  });
});

describe('limity w punktach kodowych i znak NUL', () => {
  it('100 znaków spoza BMP (200 jednostek UTF-16) mieści się w limicie jak w bazie', async () => {
    const base = payload({ keyword: 'x' });
    const res = await saveSearchAction({ ...base, filters: { keyword: '😀'.repeat(100) } });
    expect(res).toMatchObject({ ok: true });
  });

  it('101 punktów kodowych jest odrzucone, także nazwa powyżej 80', async () => {
    const base = payload({ keyword: 'x' });
    expect(await saveSearchAction({ ...base, filters: { keyword: '😀'.repeat(101) } })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await saveSearchAction({ ...base, name: '😀'.repeat(81) })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await saveSearchAction({ ...base, name: '😀'.repeat(80) })).toMatchObject({ ok: true });
  });

  it('NUL w słowie, mieście, liście lub nazwie → VALIDATION_FAILED bez zapytania do bazy', async () => {
    const base = payload({ keyword: 'x' });
    for (const bad of [
      { ...base, filters: { keyword: 'a\u0000b' } },
      { ...base, filters: { city: 'a\u0000b' } },
      { ...base, filters: { locations: ['Liège', 'a\u0000b'] } },
      { ...base, name: 'moje\u0000' },
    ]) {
      expect(await saveSearchAction(bad)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(fakeDb.calls).toHaveLength(0);
  });
});
