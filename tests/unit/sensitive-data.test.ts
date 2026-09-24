import { describe, expect, it } from 'vitest';

import {
  containsPersonalIdentifier,
  findSensitiveData,
  isValidBelgianCardNumber,
  isValidBelgianNationalNumber,
  isValidPesel,
  redactSensitiveData,
} from '@/lib/privacy/sensitive-data';

/**
 * #495/#500: deterministyczne wykrywanie NISS/BIS, PESEL, numerów dokumentów, e-maili
 * i telefonów. Wszystkie numery są SYNTETYCZNE (policzone z reguły sumy kontrolnej).
 */

// NISS urodzonego przed 2000 (suma 97 − 850730033 mod 97 = 28).
const NISS = '85073003328';
// NISS urodzonego od 2000 (suma liczona z prefiksem 2).
const NISS_2000 = '01020300467';
// BIS (miesiąc + 40).
const BIS = '85473003317';
const PESEL = '44051401359';
const CARD = '591-2345678-29';

describe('sumy kontrolne', () => {
  it('NISS/BIS: poprawne numery przechodzą, obie ery', () => {
    expect(isValidBelgianNationalNumber(NISS)).toBe(true);
    expect(isValidBelgianNationalNumber('85.07.30-033.28')).toBe(true);
    expect(isValidBelgianNationalNumber(NISS_2000)).toBe(true);
    expect(isValidBelgianNationalNumber(BIS)).toBe(true);
  });

  it('kontrola ujemna: zła suma, zły miesiąc, nr porządkowy 000, zła długość', () => {
    expect(isValidBelgianNationalNumber('85073003329')).toBe(false);
    expect(isValidBelgianNationalNumber('85133003300')).toBe(false); // miesiąc 13
    expect(isValidBelgianNationalNumber('85073000000')).toBe(false); // nr 000
    expect(isValidBelgianNationalNumber('8507300332')).toBe(false);
    expect(isValidBelgianNationalNumber('850730033280')).toBe(false);
    // Post-2000 z sumą z ery sprzed 2000 (i odwrotnie) — nadal musi pasować jedna z reguł.
    expect(isValidBelgianNationalNumber('01020300400')).toBe(false);
  });

  it('PESEL i karta eID', () => {
    expect(isValidPesel(PESEL)).toBe(true);
    expect(isValidPesel('44051401358')).toBe(false);
    expect(isValidPesel('44131401350')).toBe(false); // miesiąc 13
    expect(isValidBelgianCardNumber(CARD)).toBe(true);
    expect(isValidBelgianCardNumber('591-2345678-30')).toBe(false);
  });
});

describe('findSensitiveData — identyfikatory', () => {
  it.each([
    [`Mój numer: ${NISS}`],
    ['NISS 85.07.30-033.28'],
    ['rijksregisternummer 85 07 30 033 28'],
    [`Numéro BIS ${BIS}`],
    [`urodzony w 2001, ${NISS_2000}`],
    [`PESEL: ${PESEL}`],
    [`karta eID ${CARD}`],
  ])('wykrywa numer w „%s”', (text) => {
    expect(containsPersonalIdentifier(text)).toBe(true);
  });

  it.each([
    ['Mój NISS to 12345678901'], // błędna suma, ale jawnie podany numer
    ['INSZ: 123456789'],
    ['paszport nr EA1234567'],
    ['Passport number: EH 123456'],
    ['numer dowodu osobistego ABC123456'],
    ['carte d’identité n° 592-1234567-00'],
    ['identiteitskaart 592 1234567 00'],
  ])('wykrywa numer po słowie kluczowym w „%s”', (text) => {
    expect(containsPersonalIdentifier(text)).toBe(true);
  });

  it.each([
    ['Wynagrodzenie 2500 EUR brutto, 15,50 €/h, premia 1.250,00'],
    ['Stawka 17.50 za godzinę, 38 u/week, start 01.10.2026'],
    ['Telefon +32 471 23 45 67 albo 0471 23 45 67'],
    ['+32471234567'], // 11 cyfr jak NISS, ale to numer z „+”
    ['0032471234567'],
    ['IBAN BE68 5390 0754 7034, VAT BE 0123.456.749'],
    ['Kod pocztowy 2000 Antwerpen, ul. Długa 12 bis'],
    ['Mam ważny paszport i prawo jazdy kat. B, doświadczenie 5 lat'],
    ['Numer oferty 12345678901'], // 11 cyfr bez poprawnej sumy i bez słowa kluczowego
    ['Zamówienie 2026-09-24/123456'],
    ['Passport required. Salary 2500-3000 EUR'],
  ])('brak fałszywego trafienia w „%s”', (text) => {
    expect(containsPersonalIdentifier(text)).toBe(false);
  });

  it('pusty tekst i null', () => {
    expect(containsPersonalIdentifier('')).toBe(false);
    expect(containsPersonalIdentifier(null)).toBe(false);
    expect(containsPersonalIdentifier(undefined)).toBe(false);
  });

  it('numer sklejony z literami/cyframi nie jest dopasowany fragmentami', () => {
    expect(containsPersonalIdentifier(`X${NISS}`)).toBe(false);
    expect(containsPersonalIdentifier(`${NISS}9`)).toBe(false);
  });
});

describe('findSensitiveData — kontakt', () => {
  it('e-mail i telefony (międzynarodowy, krajowy, z (0))', () => {
    const text = 'Kontakt: jan.kowalski@firma.be, +32 (0)3 123 45 67, 02/123.45.67, 0471 23 45 67';
    const kinds = findSensitiveData(text).map((m) => m.kind);
    expect(kinds).toEqual(['email', 'phone', 'phone', 'phone']);
  });

  it('brak fałszywych trafień telefonu na kwotach, datach i kodach', () => {
    for (const text of [
      'Salaris € 2.500,00 bruto per maand',
      'Start 01.09.2026',
      'Start 01.09.2026 10:00',
      '38 uur per week, 15,50 EUR/uur',
      'Postcode 2000, 1000 Brussel',
    ]) {
      expect(findSensitiveData(text, ['phone', 'email'])).toEqual([]);
    }
  });
});

describe('redactSensitiveData', () => {
  it('zastępuje dane znacznikami i liczy je bez wartości', () => {
    const { text, counts } = redactSensitiveData(
      `Pisz do anna@example.be lub dzwoń 0471 23 45 67. NISS ${NISS}. Pensja 2500 EUR.`,
    );
    expect(text).toBe(
      'Pisz do [email removed] lub dzwoń [phone removed]. NISS [identifier removed]. Pensja 2500 EUR.',
    );
    expect(counts).toEqual({ nationalId: 1, document: 0, email: 1, phone: 1 });
  });

  it('bez dopasowań zwraca ten sam tekst', () => {
    const input = 'Magazynier, Antwerpia, 15 EUR/h';
    expect(redactSensitiveData(input).text).toBe(input);
  });

  it('tylko wybrane rodzaje', () => {
    const { text } = redactSensitiveData(`tel 0471 23 45 67, NISS ${NISS}`, ['nationalId']);
    expect(text).toBe('tel 0471 23 45 67, NISS [identifier removed]');
  });
});
