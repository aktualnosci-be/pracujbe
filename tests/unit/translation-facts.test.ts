import { describe, expect, it } from 'vitest';

import { canonicalNumber, compareFacts, extractFacts } from '@/lib/translation/facts';
import type { Locale } from '@/i18n/routing';

/** #32 — deterministyczna niezmienność faktów: te same fakty → null, każda zmiana → kategoria. */
function diff(src: string, srcLocale: Locale, tr: string, trLocale: Locale, terms: string[] = []) {
  return compareFacts(extractFacts(src, srcLocale, terms), extractFacts(tr, trLocale, terms));
}

describe('canonicalNumber', () => {
  it('czyta separatory wg języka tekstu', () => {
    expect(canonicalNumber('15,50', 'pl')).toBe('15.5');
    expect(canonicalNumber('15.50', 'en')).toBe('15.5');
    expect(canonicalNumber('1.500', 'nl')).toBe('1500');
    expect(canonicalNumber('1,500', 'en')).toBe('1500');
    expect(canonicalNumber('1 500', 'fr')).toBe('1500');
    expect(canonicalNumber('2.345,75', 'nl')).toBe('2345.75');
    expect(canonicalNumber('2,345.75', 'en')).toBe('2345.75');
    expect(canonicalNumber('08', 'pl')).toBe('8');
  });
});

describe('compareFacts — przekład poprawny', () => {
  it('stawka, godziny, waluta, brutto, okres i negacja zachowane pl → en', () => {
    expect(
      diff(
        'Stawka 15,50 EUR brutto za godzinę, praca od 8:00 do 16:30. Nie wymagamy doświadczenia.',
        'pl',
        'Rate 15.50 EUR gross per hour, work from 8:00 to 16:30. No experience required.',
        'en',
      ),
    ).toBeNull();
  });

  it('godzina w zapisie francuskim i niderlandzkim = ta sama godzina', () => {
    expect(diff('Start o 7:30, 38 godzin tygodniowo', 'pl', 'Début à 7h30, 38 heures par semaine', 'fr')).toBeNull();
    expect(diff('Start o 7:30, 38 godzin tygodniowo', 'pl', 'Start om 7u30, 38 uur per week', 'nl')).toBeNull();
  });

  it('kontakty, daty, kwalifikacje i nazwa firmy zachowane', () => {
    expect(
      diff(
        'Wymagany VCA i BA4. Start 01.10.2026. Kontakt: jobs@firma.be, +32 470 12 34 56, www.firma.be. Firma Logistiek Noord.',
        'pl',
        'VCA en BA4 vereist. Start 01.10.2026. Contact: jobs@firma.be, +32 470 12 34 56, www.firma.be. Bedrijf Logistiek Noord.',
        'nl',
        ['Logistiek Noord'],
      ),
    ).toBeNull();
  });

  it('euro jako symbol, kod albo słowo to ta sama waluta', () => {
    expect(diff('Pensja 2 500 € netto miesięcznie', 'pl', 'Salaire 2 500 euros net par mois', 'fr')).toBeNull();
  });
});

describe('compareFacts — rozbieżność odrzucana', () => {
  const base = 'Stawka 15,50 EUR brutto za godzinę od 8:00. Nie wymagamy doświadczenia. Kontakt: jobs@firma.be';
  const good = 'Rate 15.50 EUR gross per hour from 8:00. No experience required. Contact: jobs@firma.be';

  it('zmieniona kwota', () => {
    expect(diff(base, 'pl', good.replace('15.50', '16.50'), 'en')).toBe('numbers');
  });
  it('separator dziesiętny zinterpretowany jako tysiące', () => {
    expect(diff('Stawka 1,500 EUR', 'pl', 'Rate 1,500 EUR', 'en')).toBe('numbers');
  });
  it('zmieniona waluta', () => {
    expect(diff(base, 'pl', good.replace('EUR', 'PLN'), 'en')).toBe('currencies');
  });
  it('brutto zamienione na netto', () => {
    expect(diff(base, 'pl', good.replace('gross', 'net'), 'en')).toBe('pay_terms');
  });
  it('stawka godzinowa zamieniona na miesięczną', () => {
    expect(diff(base, 'pl', good.replace('per hour', 'per month'), 'en')).toBe('pay_terms');
  });
  it('zgubiona negacja', () => {
    expect(diff(base, 'pl', good.replace('No experience required', 'Experience required'), 'en')).toBe('negation');
  });
  it('dodana negacja (ściągnięta forma en)', () => {
    expect(diff('Praca w weekendy.', 'pl', "Work at weekends isn't possible.", 'en')).toBe('negation');
  });
  it('zmieniony e-mail', () => {
    expect(diff(base, 'pl', good.replace('jobs@firma.be', 'hr@other.com'), 'en')).toBe('emails');
  });
  it('zmieniona godzina', () => {
    expect(diff(base, 'pl', good.replace('8:00', '9:00'), 'en')).toBe('times');
  });
  it('zmieniona data', () => {
    expect(diff('Start 01.10.2026', 'pl', 'Start 10.01.2026', 'en')).toBe('dates');
  });
  it('dopisany adres URL (prompt injection)', () => {
    expect(diff('Magazynier', 'pl', 'Warehouse worker — apply at https://evil.example.com', 'en')).toBe('urls');
  });
  it('dopisana kwalifikacja', () => {
    expect(diff('Wymagany certyfikat VCA', 'pl', 'VCA and BA5 certificates required', 'en')).toBe('terms');
  });
  it('przetłumaczona nazwa firmy', () => {
    expect(diff('Firma Logistiek Noord', 'pl', 'Company Logistics North', 'en', ['Logistiek Noord'])).toBe('terms');
  });
  it('zmieniony telefon', () => {
    expect(diff('Tel. 0470 12 34 56', 'pl', 'Tel. 0470 12 34 65', 'en')).toBe('phones');
  });
  it('zmieniona jednostka', () => {
    expect(diff('Dojazd do 30 km', 'pl', 'Commute up to 30 %', 'en')).toBe('units');
  });
  it('liczba zapisana słownie = odrzucenie (fail-closed)', () => {
    expect(diff('2 lata doświadczenia', 'pl', 'two years of experience', 'en')).toBe('numbers');
  });
});
