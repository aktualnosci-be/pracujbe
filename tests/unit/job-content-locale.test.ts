import { describe, expect, it } from 'vitest';
import { defaultAlternateLocale, resolveJobContentLocales } from '@/lib/job-content-locale';

const job = { title: 'Magazynier', description: 'Opis PL' };

describe('resolveJobContentLocales (#301)', () => {
  it('oferta tylko po polsku otwarta w NL: treść PL, dostępne tylko PL', () => {
    expect(resolveJobContentLocales('nl', job, [{ locale: 'pl', ...job }])).toEqual({
      contentLocale: 'pl',
      availableLocales: ['pl'],
    });
  });

  it('rozpoznaje użyte tłumaczenie po treści, gdy jest ich kilka', () => {
    const rows = [
      { locale: 'en', title: 'Warehouse', description: 'EN' },
      { locale: 'pl', ...job },
    ];
    expect(resolveJobContentLocales('fr', job, rows)).toEqual({
      contentLocale: 'pl',
      availableLocales: ['pl', 'en'],
    });
  });

  it('przy identycznej treści wygrywa język strony', () => {
    const rows = [{ locale: 'pl', ...job }, { locale: 'nl', ...job }];
    expect(resolveJobContentLocales('nl', job, rows).contentLocale).toBe('nl');
  });

  it('brak pasującego tłumaczenia = język nieznany; pomija nieobsługiwane locale', () => {
    const rows = [{ locale: 'de', ...job }, { locale: 'en', title: 'Inny', description: null }];
    expect(resolveJobContentLocales('pl', job, rows)).toEqual({
      contentLocale: undefined,
      availableLocales: ['en'],
    });
  });

  it('x-default: język domyślny, jeśli dostępny, inaczej pierwszy dostępny', () => {
    expect(defaultAlternateLocale(['nl', 'pl'])).toBe('pl');
    expect(defaultAlternateLocale(['fr'])).toBe('fr');
    expect(defaultAlternateLocale([])).toBeUndefined();
  });
});
