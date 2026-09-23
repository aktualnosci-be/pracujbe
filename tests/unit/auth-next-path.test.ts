// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { safeNextPath } from '@/lib/validation/auth';

describe('safeNextPath — bezpieczny parametr powrotu po logowaniu', () => {
  it.each([
    ['/pl/oferty-pracy/murarz-bruksela-1002', '/pl/oferty-pracy/murarz-bruksela-1002'],
    ['/nl/oferty-pracy/x?utm=1#apply', '/nl/oferty-pracy/x?utm=1#apply'],
    ['/en', '/en'],
    ['/fr/candidate', '/fr/candidate'],
  ])('przyjmuje ścieżkę w serwisie %s', (input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it.each([
    ['protokół względny', '//evil.example/pl'],
    ['pełny URL', 'https://evil.example/pl/oferty-pracy'],
    ['schemat javascript', 'javascript:alert(1)'],
    ['backslash', '/\\evil.example'],
    ['backslash w środku', '/pl\\..\\\\evil.example'],
    ['znak sterujący (tab)', '/\t/evil.example'],
    ['znak nowej linii', '/pl/x\nLocation: https://evil.example'],
    ['ścieżka bez locale', '/oferty-pracy/x'],
    ['nieobsługiwany locale', '/de/oferty-pracy/x'],
    ['ścieżka względna bez ukośnika', 'pl/oferty-pracy'],
    ['pusty ciąg', ''],
    ['bardzo długi ciąg', `/pl/${'a'.repeat(2048)}`],
  ])('odrzuca: %s', (_label, input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  it('odrzuca wartości inne niż string (np. tablica z query)', () => {
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath(['/pl'])).toBeNull();
    expect(safeNextPath(42)).toBeNull();
  });

  it('wynik zawsze pozostaje w tym samym originie po rozwiązaniu względem strony', () => {
    for (const input of ['/pl/../../evil', '/pl/%2F%2Fevil.example', '/pl/./x']) {
      const out = safeNextPath(input);
      if (out !== null) {
        expect(new URL(out, 'https://pracuj.be').origin).toBe('https://pracuj.be');
        expect(out.startsWith('//')).toBe(false);
      }
    }
  });
});
