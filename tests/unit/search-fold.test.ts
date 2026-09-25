import { describe, expect, it } from 'vitest';

import { searchFold } from '@/lib/search-fold';

/**
 * Lustro `public.search_fold` (0110, #47). Oczekiwane wartości = wynik
 * `lower(unaccent('public.unaccent', …))` na PostgreSQL 16 (rls.sql SU47-6).
 */
describe('searchFold', () => {
  it.each([
    ['Liège ŁÓDŹ Șofer Préparateur', 'liege lodz sofer preparateur'],
    ['Sprzątanie', 'sprzatanie'],
    ['Straße Œuvre Ærø', 'strasse oeuvre aero'],
  ])('%s → %s', (input, expected) => {
    expect(searchFold(input)).toBe(expected);
  });

  it('cyrylica bez zmian poza ё (jak słownik unaccent) — kontrola ujemna wobec pełnego NFD', () => {
    expect(searchFold('Водій Ёлка')).toBe('водій елка');
    // Pełne usunięcie znaków łączących zmieniłoby „й” w „и” — tego unaccent nie robi.
    expect('водій'.normalize('NFD').replace(/\p{M}/gu, '')).not.toBe(searchFold('Водій'));
  });

  it('nie rusza znaków %, _ i \\ (escapowanie robi SQL)', () => {
    expect(searchFold('50% a_b \\')).toBe('50% a_b \\');
  });
});
