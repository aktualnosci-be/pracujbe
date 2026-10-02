import { describe, expect, it } from 'vitest';

import { canonicalNumber, compareFacts, extractFacts, normalizeEmailCase, normalizeUrlCase } from '@/lib/translation/facts';
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
  // #803 — case-insensitive tylko schemat/host; ścieżka/query/fragment rozróżniają wielkość liter.
  it('zmieniona wielkość liter w ścieżce URL', () => {
    expect(diff('Aplikuj: https://example.com/Apply', 'pl', 'Apply at https://example.com/apply', 'en')).toBe('urls');
  });
  it('zmieniona wielkość liter w tokenie query', () => {
    expect(
      diff(
        'Aplikuj: https://example.com/apply?token=AbCdEf',
        'pl',
        'Apply at https://example.com/apply?token=abcdef',
        'en',
      ),
    ).toBe('urls');
  });
  it('zmieniona wielkość liter fragmentu URL', () => {
    expect(diff('Zobacz https://example.com/oferta#Sekcja', 'pl', 'See https://example.com/oferta#sekcja', 'en')).toBe(
      'urls',
    );
  });
  it('sama zmiana wielkości liter schematu/hosta to ten sam adres', () => {
    expect(diff('Aplikuj: HTTPS://Example.COM/apply', 'pl', 'Apply at https://example.com/apply', 'en')).toBeNull();
  });
  // #808 — local-part e-maila rozróżnia wielkość liter (RFC 5321 §2.4); domena nie.
  it('zmieniona wielkość liter w local-part e-maila', () => {
    expect(diff('Kontakt: Alice.Smith@company.be', 'pl', 'Contact: alice.smith@company.be', 'en')).toBe('emails');
  });
  it('sama zmiana wielkości liter domeny e-maila to ten sam adres', () => {
    expect(diff('Kontakt: alice.smith@Company.BE', 'pl', 'Contact: alice.smith@company.be', 'en')).toBeNull();
  });
});

describe('normalizeUrlCase', () => {
  it('normalizuje schemat i host, zachowuje ścieżkę/query/fragment', () => {
    expect(normalizeUrlCase('HTTPS://Example.COM/Apply?Token=AbC#Frag')).toBe('https://example.com/Apply?Token=AbC#Frag');
  });
  it('www. bez schematu — host małymi literami, reszta bez zmian', () => {
    expect(normalizeUrlCase('WWW.Example.COM/Path')).toBe('www.example.com/Path');
  });
  it('brak schematu/www — bez zmian zachowania (cała wartość małymi literami)', () => {
    expect(normalizeUrlCase('Example.COM')).toBe('example.com');
  });
});

describe('normalizeEmailCase', () => {
  it('zachowuje local-part, normalizuje tylko domenę', () => {
    expect(normalizeEmailCase('Alice.Smith@Company.BE')).toBe('Alice.Smith@company.be');
  });
  it('bez @ — kontrola ujemna: cała wartość małymi literami (dopasowanie zawsze ma @)', () => {
    expect(normalizeEmailCase('NoAt')).toBe('noat');
  });
});

describe('znak liczby (#738)', () => {
  it('zmiana -5°C na 5°C jest odrzucona, zgodny znak przechodzi', () => {
    expect(diff('Temperatura -5°C', 'pl', 'Temperature 5°C', 'en')).toBe('numbers');
    expect(diff('Temperatura 5°C', 'pl', 'Temperature -5°C', 'en')).toBe('numbers');
    expect(diff('Temperatura -5°C', 'pl', 'Temperature -5°C', 'en')).toBeNull();
    expect(diff('Korekta -1,5 EUR', 'pl', 'Adjustment −1.5 EUR', 'en')).toBeNull();
  });
  it('+5 = 5, a zakresy i oznaczenia z myślnikiem nie są ujemne', () => {
    expect(diff('Premia +5 EUR', 'pl', 'Bonus 5 EUR', 'en')).toBeNull();
    expect(extractFacts('od 5-10 EUR', 'pl').numbers).toEqual(['10', '5']);
    expect(extractFacts('B-2 i 5 - 10', 'pl').numbers).toEqual(['10', '2', '5']);
    expect(extractFacts('-0', 'pl').numbers).toEqual(['0']);
  });
});

describe('daty numeryczne wg języka (#739)', () => {
  it('poprawna lokalizacja pl → en (miesiąc/dzień) przechodzi', () => {
    expect(extractFacts('Termin: 03.04.2025', 'pl').dates).toEqual(['2025-04-03']);
    expect(extractFacts('Date: 04/03/2025', 'en').dates).toEqual(['2025-04-03']);
    expect(diff('Termin: 03.04.2025', 'pl', 'Date: 04/03/2025', 'en')).toBeNull();
    expect(extractFacts('Date: 25/12/2025', 'en').dates).toEqual(['2025-12-25']);
  });
  it('kontrola ujemna: zamieniony dzień z miesiącem nadal odrzucony', () => {
    expect(diff('Termin: 03.04.2025', 'pl', 'Date: 03/04/2025', 'en')).toBe('dates');
    expect(extractFacts('Date: 04.03.2025', 'en').dates).toEqual(['2025-03-04']);
    expect(extractFacts('04/03/2025', 'nl').dates).toEqual(['2025-03-04']);
  });
});

describe('okres stawki: niderlandzkie „u” (#1067)', () => {
  it('forma grzecznościowa „u” nie jest stawką godzinową', () => {
    const nl = 'Wij bieden u een vaste job aan. Bruto loon 2 500 EUR per maand.';
    expect(extractFacts(nl, 'nl').pay_terms).toEqual(['gross', 'per_month']);
    expect(
      diff(nl, 'nl', 'Oferujemy Panu stałą pracę. Wynagrodzenie brutto 2 500 EUR miesięcznie.', 'pl'),
    ).toBeNull();
    expect(
      diff(nl, 'nl', 'Nous vous proposons un emploi fixe. Salaire brut 2 500 EUR par mois.', 'fr'),
    ).toBeNull();
  });

  it('skrót „u” z kontekstem liczby, waluty albo ukośnika nadal oznacza godzinę', () => {
    for (const text of ['Loon 15 u', 'Loon 15u', 'Loon €/u', 'Loon 15,50 EUR/u', 'Loon 15 u']) {
      expect(extractFacts(text, 'nl').pay_terms, text).toContain('per_hour');
    }
    expect(diff('Stawka 15,50 EUR/godz.', 'pl', 'Loon 15,50 EUR/u', 'nl')).toBeNull();
    expect(diff('Stawka 15,50 EUR/godz.', 'pl', 'Loon 15,50 EUR/maand', 'nl')).toBe('pay_terms');
  });

  it('kontrola ujemna: zgubiona godzinowa stawka w formie „15 u” nadal odrzucona', () => {
    expect(diff('Loon 15 u brutto', 'nl', 'Salaire 15 EUR brut par mois', 'fr')).not.toBeNull();
  });

  it('samotne „h”/„hr” bez liczby też nie jest okresem stawki', () => {
    expect(extractFacts('Plan h in het bedrijf', 'nl').pay_terms).toEqual([]);
    expect(extractFacts('Rate 15 hr', 'en').pay_terms).toEqual(['per_hour']);
    expect(extractFacts('Vitamin h', 'en').pay_terms).toEqual([]);
  });
});

describe('negacja zdanie po zdaniu (#1106)', () => {
  const src = 'Praca w weekendy. Nie wymagamy doświadczenia. Oferujemy szkolenie.';

  it('ta sama liczba zdań, negacja na tym samym miejscu = ok', () => {
    expect(diff(src, 'pl', 'Work at weekends. No experience required. We offer training.', 'en')).toBeNull();
  });

  it('negacja przeniesiona do innego zdania (ta sama obecność w polu) jest odrzucona', () => {
    // Obecność „gdzieś w polu” zgadza się, ale sens zdań zmieniony.
    expect(diff(src, 'pl', 'Work at weekends is not possible. Experience required. We offer training.', 'en')).toBe(
      'negation',
    );
  });

  it('kontrola ujemna: gdy zdania się nie zgadzają, wystarcza obecność w polu (bez fałszywych odrzuceń)', () => {
    expect(
      diff(src, 'pl', 'Work at weekends. No experience required, and we offer training.', 'en'),
    ).toBeNull();
  });

  it('wiersze listy liczą się jak zdania', () => {
    expect(diff('Prawo jazdy\nBez doświadczenia\nWłasny samochód', 'pl', 'Driving licence\nNo experience\nOwn car', 'en')).toBeNull();
    expect(diff('Prawo jazdy\nBez doświadczenia\nWłasny samochód', 'pl', 'Driving licence\nExperience\nNo own car', 'en')).toBe(
      'negation',
    );
  });
});

describe('negacja w zdaniach z faktami przy innej liczbie zdań (#1106)', () => {
  const src = 'Wymagamy prawa jazdy C95. Nie wymagamy certyfikatu VCA.';

  it('wierny przekład z podziałem zdań = ok', () => {
    expect(diff(src, 'pl', 'We require a C95 licence. A VCA certificate is not required. Apply today.', 'en')).toBeNull();
  });

  it('negacja przeniesiona na inne wymaganie (inna liczba zdań) jest odrzucona', () => {
    // W polu negacja jest po obu stronach, a liczba zdań się różni — dawniej przechodziło.
    expect(diff(src, 'pl', 'A C95 licence is not required. We require a VCA certificate. Apply today.', 'en')).toBe(
      'negation',
    );
  });

  it('kontrola ujemna: przekład łączący zdania nie dostaje fałszywego odrzucenia', () => {
    expect(
      diff(
        'Stawka 15 EUR za godzinę. Nie wymagamy doświadczenia. Oferujemy szkolenie.',
        'pl',
        'Rate 15 EUR per hour, no experience required. We offer training.',
        'en',
      ),
    ).toBeNull();
  });

  it('kontrola ujemna: odcisk faktów niejednoznaczny (dwa zdania z tymi samymi faktami) nie jest porównywany', () => {
    expect(
      extractFacts('Prawo jazdy C95. Bez C95 nie. Dalej.', 'pl').negationAnchors.filter((a) => a.key.includes('C95')),
    ).toHaveLength(2);
    expect(diff('Prawo jazdy C95. Bez C95 nie.', 'pl', 'No C95 licence. C95 needed. Thanks.', 'en')).toBeNull();
  });
});
