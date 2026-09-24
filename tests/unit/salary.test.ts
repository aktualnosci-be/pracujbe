import { describe, expect, it, vi } from 'vitest';
import { formatSalaryRange, normalizeSalary, type SalaryInput } from '@/lib/salary';
import { salaryLabelsFor } from '@/lib/salary-labels';
import { buildJobPostingJsonLd } from '@/lib/seo/structured-data';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { getJobBySlug } from '@/lib/jobs';

/**
 * #22 — jedno źródło zapisu wynagrodzenia (karta, szczegół, podobne oferty, JSON-LD, e-mail).
 * Oczekiwane teksty są wpisane dosłownie (spacje w `Intl` to NBSP / wąska NBSP), żeby test
 * nie powtarzał implementacji.
 */

const NBSP = ' ';
const NNBSP = ' ';

type Case = [name: string, input: SalaryInput, expected: Record<'pl' | 'nl' | 'fr' | 'en', string | null>];

const CASES: Case[] = [
  ['widełki z groszami (obie granice z dwoma miejscami)', { salaryMin: 18.75, salaryMax: 22.5, currency: 'EUR', salaryPeriod: 'hour' }, {
    pl: `18,75${NBSP}€ – 22,50${NBSP}€ brutto / godz.`,
    nl: `€${NBSP}18,75 – €${NBSP}22,50 bruto / uur`,
    fr: `18,75${NBSP}€ – 22,50${NBSP}€ brut / heure`,
    en: '€18.75 – €22.50 gross / hour',
  }],
  ['pełne euro bez zbędnych zer', { salaryMin: 2400, salaryMax: 2800, currency: 'EUR', salaryPeriod: 'month' }, {
    pl: `2400${NBSP}€ – 2800${NBSP}€ brutto / mies.`,
    nl: `€${NBSP}2.400 – €${NBSP}2.800 bruto / maand`,
    fr: `2${NNBSP}400${NBSP}€ – 2${NNBSP}800${NBSP}€ brut / mois`,
    en: '€2,400 – €2,800 gross / month',
  }],
  ['tylko minimum → „od”', { salaryMin: 18.75, currency: 'EUR', salaryPeriod: 'hour' }, {
    pl: `od 18,75${NBSP}€ brutto / godz.`,
    nl: `vanaf €${NBSP}18,75 bruto / uur`,
    fr: `à partir de 18,75${NBSP}€ brut / heure`,
    en: 'from €18.75 gross / hour',
  }],
  ['tylko maksimum → „do”', { salaryMax: 36000, currency: 'EUR', salaryPeriod: 'year' }, {
    pl: `do 36${NBSP}000${NBSP}€ brutto / rok`,
    nl: `tot €${NBSP}36.000 bruto / jaar`,
    fr: `jusqu’à 36${NNBSP}000${NBSP}€ brut / an`,
    en: 'up to €36,000 gross / year',
  }],
  ['min = max → jedna kwota', { salaryMin: 3000, salaryMax: 3000, currency: 'EUR', salaryPeriod: 'month' }, {
    pl: `3000${NBSP}€ brutto / mies.`,
    nl: `€${NBSP}3.000 bruto / maand`,
    fr: `3${NNBSP}000${NBSP}€ brut / mois`,
    en: '€3,000 gross / month',
  }],
  ['brak okresu → bez sufiksu (bez zgadywania)', { salaryMin: 18.75, currency: 'EUR' }, {
    pl: `od 18,75${NBSP}€`, nl: `vanaf €${NBSP}18,75`, fr: `à partir de 18,75${NBSP}€`, en: 'from €18.75',
  }],
  ['zero to realna kwota', { salaryMin: 0, currency: 'EUR', salaryPeriod: 'hour' }, {
    pl: `od 0${NBSP}€ brutto / godz.`, nl: `vanaf €${NBSP}0 bruto / uur`, fr: `à partir de 0${NBSP}€ brut / heure`, en: 'from €0 gross / hour',
  }],
  ['odwrócone widełki są porządkowane', { salaryMin: 22.5, salaryMax: 18.75, currency: 'EUR', salaryPeriod: 'hour' }, {
    pl: `18,75${NBSP}€ – 22,50${NBSP}€ brutto / godz.`,
    nl: `€${NBSP}18,75 – €${NBSP}22,50 bruto / uur`,
    fr: `18,75${NBSP}€ – 22,50${NBSP}€ brut / heure`,
    en: '€18.75 – €22.50 gross / hour',
  }],
  ['brak kwoty → brak pola', { currency: 'EUR', salaryPeriod: 'month' }, { pl: null, nl: null, fr: null, en: null }],
  ['kwoty nieprawidłowe (NaN, ujemna) → brak pola', { salaryMin: Number.NaN, salaryMax: -5, currency: 'EUR', salaryPeriod: 'month' }, {
    pl: null, nl: null, fr: null, en: null,
  }],
  ['niepoprawny kod waluty → EUR zamiast wyjątku', { salaryMin: 2000, currency: 'EURO', salaryPeriod: 'month' }, {
    pl: `od 2000${NBSP}€ brutto / mies.`, nl: `vanaf €${NBSP}2.000 bruto / maand`, fr: `à partir de 2${NNBSP}000${NBSP}€ brut / mois`, en: 'from €2,000 gross / month',
  }],
];

describe('formatSalaryRange (#22)', () => {
  for (const [name, input, expected] of CASES) {
    it.each(Object.entries(expected))(`${name}: %s`, (locale, text) => {
      expect(formatSalaryRange(input, locale, salaryLabelsFor(locale))).toBe(text);
    });
  }

  it('kontrola ujemna: grosze nie są zaokrąglane do pełnych euro ani do jednego miejsca', () => {
    const text = formatSalaryRange({ salaryMin: 18.75, salaryMax: 22.5, currency: 'EUR', salaryPeriod: 'hour' }, 'pl', salaryLabelsFor('pl'));
    expect(text).not.toContain('19');
    expect(text).not.toMatch(/22,5(?!0)/);
  });

  it('kontrola ujemna: jedna granica nigdy nie wygląda jak kwota dokładna, brak kwoty nie jest „do negocjacji”', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const labels = salaryLabelsFor(locale);
      const onlyMin = formatSalaryRange({ salaryMin: 850, currency: 'EUR', salaryPeriod: 'month' }, locale, labels)!;
      expect(onlyMin.startsWith(labels.from('').trim())).toBe(true);
      expect(formatSalaryRange({ currency: 'EUR' }, locale, labels)).toBeNull();
    }
  });

  it('bez rozpoznanego okresu nie próbuje tłumaczyć okresu', () => {
    const labels = salaryLabelsFor('en');
    const period = vi.fn(labels.period);
    expect(formatSalaryRange({ currency: 'EUR', salaryMin: 18.75 }, 'en', { ...labels, period })).toBe('from €18.75');
    expect(period).not.toHaveBeenCalled();
  });

  it('nieobsługiwany locale etykiet → angielskie etykiety', () => {
    expect(salaryLabelsFor('de').from('x')).toBe('from x');
  });
});

describe('normalizeSalary + JobPosting JSON-LD używają tych samych granic', () => {
  it.each([
    [{ salaryMin: 18.75, salaryMax: 22.5, salaryPeriod: 'hour' as const }, { minValue: 18.75, maxValue: 22.5, unitText: 'HOUR' }],
    [{ salaryMin: 850, salaryPeriod: 'month' as const }, { minValue: 850, unitText: 'MONTH' }],
    [{ salaryMax: 36000, salaryPeriod: 'year' as const }, { maxValue: 36000, unitText: 'YEAR' }],
    [{ salaryMin: 3000, salaryMax: 3000, salaryPeriod: 'month' as const }, { value: 3000, unitText: 'MONTH' }],
    [{ salaryMin: 20, salaryMax: 18 }, { minValue: 18, maxValue: 20 }],
  ])('%j', async (salary, value) => {
    const job = (await getJobBySlug('warehouse-worker-antwerp-1001', 'en'))!;
    const data = buildJobPostingJsonLd(
      { ...job, salaryMin: undefined, salaryMax: undefined, salaryPeriod: undefined, ...salary },
      'https://example.test/en/oferty-pracy/x',
      { requirementsMandatory: 'M', requirementsOptional: 'O', responsibilities: 'R', conditions: 'C', workingHours: 'W', shifts: 'S' },
    );
    expect(data.baseSalary).toEqual({
      '@type': 'MonetaryAmount',
      currency: 'EUR',
      value: { '@type': 'QuantitativeValue', ...value },
    });
  });

  it('kontrola ujemna: brak kwoty → brak baseSalary w JSON-LD i null w normalizeSalary', async () => {
    const job = (await getJobBySlug('warehouse-worker-antwerp-1001', 'en'))!;
    expect(normalizeSalary({ currency: 'EUR', salaryPeriod: 'month' })).toBeNull();
    const data = buildJobPostingJsonLd(
      { ...job, salaryMin: undefined, salaryMax: undefined },
      'https://example.test/x',
      { requirementsMandatory: 'M', requirementsOptional: 'O', responsibilities: 'R', conditions: 'C', workingHours: 'W', shifts: 'S' },
    );
    expect(data.baseSalary).toBeUndefined();
  });
});

describe('e-mail: wynagrodzenie w locale odbiorcy z kwot w payloadzie', () => {
  const payload = { jobTitle: 'X', salaryMin: 18.75, salaryMax: 22.5, salaryPeriod: 'hour', currency: 'EUR' };

  it.each([
    ['pl', `18,75${NBSP}€ – 22,50${NBSP}€ brutto / godz.`],
    ['nl', `€${NBSP}18,75 – €${NBSP}22,50 bruto / uur`],
    ['fr', `18,75${NBSP}€ – 22,50${NBSP}€ brut / heure`],
    ['en', '€18.75 – €22.50 gross / hour'],
  ])('%s', (locale, expected) => {
    const { data } = buildDeliveryData({ template: 'jobOffer', locale, payload }, 'https://example.test');
    expect(data['salary']).toBe(expected);
  });

  it('kontrola ujemna: gotowy tekst nadawcy nie trafia do maila; brak kwot → brak pola', () => {
    const { data } = buildDeliveryData(
      { template: 'jobOffer', locale: 'nl', payload: { jobTitle: 'X', salary: '3 200 zł / miesiąc' } },
      'https://example.test',
    );
    expect(data['salary']).toBeUndefined();
  });
});
