import { describe, expect, it } from 'vitest';

import {
  flattenSearchParams,
  parseLocationsParam,
  parseSidebarFilters,
  serializeLocations,
} from '@/components/public/job-filters';

/**
 * #795: formularz filtrów bez JavaScriptu renderował kategorię/lokalizację/rodzaj umowy/
 * zakwaterowanie jako pojedynczy `<select>`, bo `flatten()` na stronie listy
 * (`src/app/[locale]/(public)/oferty-pracy/page.tsx`) brał tylko PIERWSZĄ wartość
 * powtórzonego klucza query — a to dokładnie to, co przeglądarka wysyła dla kilku
 * zaznaczonych checkboxów o tej samej nazwie (`category=a&category=b`). `flattenSearchParams`
 * łączy powtórzone wartości w jedną (CSV, lokalizacja przez `serializeLocations`), więc
 * checkboxy w formularzu bez JS mogą reprezentować pełny, edytowalny zestaw wielu wartości.
 */
describe('flattenSearchParams (#795 — checkboxy formularza bez JS)', () => {
  it('łączy powtórzony klucz (kilka zaznaczonych checkboxów) w jedną wartość CSV', () => {
    const flat = flattenSearchParams({
      category: ['construction', 'transport'],
      contractType: ['permanent'],
      accommodation: ['provided', 'unavailable'],
      keyword: 'operator',
    });
    expect(flat.category).toBe('construction,transport');
    expect(flat.contractType).toBe('permanent');
    expect(flat.accommodation).toBe('provided,unavailable');
    expect(flat.keyword).toBe('operator');
  });

  it('łączy powtórzoną lokalizację przez serializeLocations — miasto z przecinkiem w nazwie zostaje jedną wartością', () => {
    const flat = flattenSearchParams({
      location: ['Bruxelles, Belgique', 'Antwerp'],
    });
    // Round-trip przez ten sam escaping co JS-owy sidebar (#845): dwie oryginalne wartości
    // wracają jako dwie wartości, mimo że jedna z nich zawiera przecinek.
    expect(parseLocationsParam(flat.location)).toEqual(['Bruxelles, Belgique', 'Antwerp']);
    expect(flat.location).toBe(serializeLocations(['Bruxelles, Belgique', 'Antwerp']));
  });

  it('pojedyncza wartość (pole tekstowe/select) przechodzi bez zmian', () => {
    const flat = flattenSearchParams({ sort: 'salary', page: '2' });
    expect(flat.sort).toBe('salary');
    expect(flat.page).toBe('2');
  });

  it('pusta tablica (klucz obecny bez wartości) daje undefined, nie pusty string', () => {
    const flat = flattenSearchParams({ category: [] });
    expect(flat.category).toBeUndefined();
  });

  it('koniec z końca: dwa zaznaczone checkboxy przechodzą przez stronę do SidebarFilters jako dwie wartości', () => {
    const flat = flattenSearchParams({
      category: ['construction', 'transport'],
      location: ['Brussels', 'Antwerp'],
      contractType: ['permanent', 'temporary'],
      accommodation: ['provided', 'unavailable'],
    });
    const sidebar = parseSidebarFilters(flat);
    expect(sidebar.categories).toEqual(['construction', 'transport']);
    expect(sidebar.locations).toEqual(['Brussels', 'Antwerp']);
    expect(sidebar.contractTypes).toEqual(['permanent', 'temporary']);
    expect(sidebar.accommodation).toEqual(['provided', 'unavailable']);
  });

  // Kontrola ujemna: dawne zachowanie (tylko pierwsza wartość powtórzonego klucza) traciło
  // każdą wartość poza pierwszą — dokładnie ten regres, który #795 opisuje. Ten test czerwienieje,
  // gdyby ktoś przywrócił `Array.isArray(value) ? value[0] : value` zamiast łączenia w CSV.
  it('kontrola ujemna: branie tylko pierwszej wartości gubi resztę zaznaczonych checkboxów', () => {
    const firstValueOnly = (value: string | string[] | undefined): string | undefined =>
      Array.isArray(value) ? value[0] : value;
    const legacyFlat = { category: firstValueOnly(['construction', 'transport']) };
    const legacySidebar = parseSidebarFilters(legacyFlat);
    expect(legacySidebar.categories).toEqual(['construction']);

    const fixedFlat = flattenSearchParams({ category: ['construction', 'transport'] });
    const fixedSidebar = parseSidebarFilters(fixedFlat);
    expect(fixedSidebar.categories).toEqual(['construction', 'transport']);
    expect(fixedSidebar.categories).not.toEqual(legacySidebar.categories);
  });
});
