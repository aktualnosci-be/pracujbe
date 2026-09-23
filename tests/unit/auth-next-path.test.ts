// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { loginHref, safeNextPath } from '@/lib/validation/auth';

describe('safeNextPath — bezpieczny parametr powrotu po logowaniu', () => {
  it.each([
    ['/pl/oferty-pracy/murarz-bruksela-1002', '/pl/oferty-pracy/murarz-bruksela-1002'],
    ['/nl/oferty-pracy/x?utm=1#apply', '/nl/oferty-pracy/x?utm=1#apply'],
    ['/en', '/en'],
    ['/fr/candidate', '/fr/candidate'],
    ['/nl/oferty-pracy/x', '/nl/oferty-pracy/x'],
    // Zakodowane `//` w środku ścieżki pozostaje zakodowane — przeglądarka nie zmieni originu.
    ['/pl/%2f%2fevil.example', '/pl/%2f%2fevil.example'],
    // `//` w query/hash nie zmienia originu.
    ['/pl/x?ref=//evil.example#//y', '/pl/x?ref=//evil.example#//y'],
    // Znaki spoza ASCII są kodowane procentowo (wynik zawsze ASCII).
    ['/pl/\uff0f\uff0fevil', '/pl/%EF%BC%8F%EF%BC%8Fevil'],
    ['/pl/./x/../y', '/pl/y'],
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
    ['513 znaków (granica)', `/pl/${'a'.repeat(509)}`],
    ['po normalizacji > 512 (kodowanie %)', `/pl/${'é'.repeat(200)}`],
    ['ukośnik + backslash', '/\\/evil.example'],
    ['backslash jako drugi znak', '/\\evil.example/pl'],
    ['zakodowany protokół względny bez locale', '/%2f%2fevil.example'],
    ['zakodowany backslash bez locale', '/%5c%5cevil.example'],
    ['kropki prowadzą do //host', '/pl/..//evil.example'],
    ['zakodowane kropki prowadzą do //host', '/pl/%2e%2e/%2e%2e//evil.example'],
    ['zakodowane kropki wychodzą z locale', '/pl/.%2e/.%2e/evil'],
    ['kropki wychodzą z locale', '/pl/../evil'],
    ['sam locale po kropkach', '/pl/..'],
    ['schemat data:', 'data:text/html,<script>alert(1)</script>'],
    ['schemat vbscript', 'vbscript:msgbox(1)'],
    ['schemat z ukośnikiem', '/https://evil.example'],
    ['wiodąca spacja', ' /pl/oferty-pracy'],
    ['wiodący tab', '\t//evil.example'],
    ['znak NUL', '/pl/\u0000//evil.example'],
    ['powrót karetki', '/pl/x\r\nSet-Cookie: a=b'],
    ['DEL', '/pl/\u007f'],
    ['locale wielkimi literami', '/PL/oferty-pracy/x'],
    ['inny locale spoza listy', '/es/oferty-pracy/x'],
    ['prefiks locale bez separatora', '/plx/oferty-pracy'],
    ['podwójnie zakodowany //', '%252F%252Fevil.example'],
  ])('odrzuca: %s', (_label, input) => {
    expect(safeNextPath(input)).toBeNull();
  });

  it('przyjmuje dokładnie 512 znaków (granica)', () => {
    const input = `/pl/${'a'.repeat(508)}`;
    expect(input).toHaveLength(512);
    expect(safeNextPath(input)).toBe(input);
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

describe('loginHref — link logowania z powrotem na bieżącą stronę', () => {
  it('przekazuje bezpieczną ścieżkę oferty w next', () => {
    expect(loginHref('/pl/oferty-pracy/murarz-bruksela-1002')).toEqual({
      pathname: '/logowanie',
      query: { next: '/pl/oferty-pracy/murarz-bruksela-1002' },
    });
  });

  it.each([null, undefined, '', '//evil.example/pl', '/oferty-pracy/x', 'https://evil.example'])(
    'bez bezpiecznej ścieżki (%s) zwraca zwykły link logowania',
    (input) => {
      expect(loginHref(input)).toBe('/logowanie');
    },
  );
});
