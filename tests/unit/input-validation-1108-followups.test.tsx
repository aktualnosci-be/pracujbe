import * as React from 'react';
import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/actions/saved-searches', () => ({ saveSearchAction: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

import { SaveSearchButton } from '@/components/public/SaveSearchButton';
import { buildMessageExcerpt, EXCERPT_REDACTION } from '@/lib/email/message-excerpt';
import {
  parseJobListQuery,
  savedSearchExceedsLimits,
  savedSearchFiltersFromQuery,
  savedSearchQueryString,
} from '@/lib/job-list-query';
import { extractFacts } from '@/lib/translation/facts';
import { companyDescriptionSchema } from '@/lib/validation/company';
import { contactSchema } from '@/lib/validation/contact';
import { contentReportSchema } from '@/lib/validation/content-report';
import { step1Schema, step2Schema, step3Schema, step5Schema, step9DraftSchema } from '@/lib/validation/job';
import pl from '@/messages/pl.json';

/**
 * #1108 — dokończenie poprawek walidacji wejścia po #1182: kreator oferty (NUL, data
 * rozpoczęcia), formularze publiczne (kontakt, zgłoszenie treści, opis firmy), wyrażenia
 * wykrywające domeny bez złożoności kwadratowej i zapis wyszukiwania spójny z listą ofert.
 */

const NUL = 'Magazynier\u0000 nocny';

function firstMessage(result: { success: boolean; error?: { issues: { message: string }[] } }): string | undefined {
  return result.success ? undefined : result.error?.issues[0]?.message;
}

describe('kreator oferty: znak NUL i data rozpoczęcia', () => {
  it('NUL w tytule, mieście, opisie i pozycji listy → komunikat przy polu, nie błąd bazy', () => {
    expect(firstMessage(step1Schema.shape.title.safeParse(NUL))).toBe('job.error.textInvalid');
    expect(firstMessage(step3Schema.innerType().shape.city.safeParse('Gent\u0000'))).toBe('job.error.textInvalid');
    expect(firstMessage(step5Schema.shape.description.safeParse(`${'Opis stanowiska '.repeat(3)}\u0000`))).toBe(
      'job.error.textInvalid',
    );
    expect(firstMessage(step5Schema.shape.responsibilities.safeParse(['Pakowanie\u0000']))).toBe('job.error.textInvalid');
    expect(firstMessage(step9DraftSchema.shape.companyDescription.safeParse(`${'Firma logistyczna '.repeat(2)}\u0000`))).toBe(
      'job.error.textInvalid',
    );
  });

  it('kontrola ujemna: zwykły tekst z polskimi znakami i emoji przechodzi', () => {
    expect(step1Schema.shape.title.safeParse('Magazynier — zmiana nocna 🚚').success).toBe(true);
    expect(step5Schema.shape.responsibilities.safeParse(['Załadunek i rozładunek']).success).toBe(true);
  });

  it('data rozpoczęcia z rokiem 0000 albo nieistniejącym dniem jest odrzucona przy polu', () => {
    for (const value of ['0000-01-01', '2026-02-31', '2026-13-01', '9999-12-31']) {
      expect(firstMessage(step2Schema.shape.startDate.safeParse(value)), value).toBe('job.error.startDateInvalid');
    }
  });

  it('kontrola ujemna: prawidłowa data i brak daty przechodzą', () => {
    expect(step2Schema.shape.startDate.safeParse('2026-10-15').success).toBe(true);
    expect(step2Schema.shape.startDate.safeParse('2028-02-29').success).toBe(true);
    expect(step2Schema.shape.startDate.safeParse(undefined).success).toBe(true);
  });
});

describe('formularze publiczne: znak NUL', () => {
  it('kontakt, zgłoszenie treści i opis firmy mają własny komunikat', () => {
    const message = `Dzień dobry, mam pytanie o konto.\u0000`;
    expect(firstMessage(contactSchema.shape.message.safeParse(message))).toBe('contact.error.textInvalid');
    expect(firstMessage(contentReportSchema.shape.details.safeParse(`Oferta wygląda na oszustwo.\u0000`))).toBe(
      'contentReport.error.textInvalid',
    );
    expect(firstMessage(contentReportSchema.shape.contentUrl.safeParse('https://pracuj.be/a\u0000b'))).toBe(
      'contentReport.error.urlInvalid',
    );
    expect(firstMessage(companyDescriptionSchema.shape.description.safeParse('Firma\u0000'))).toBe(
      'company.error.textInvalid',
    );
  });

  it('kontrola ujemna: te same pola bez NUL przechodzą', () => {
    expect(contactSchema.shape.message.safeParse('Dzień dobry, mam pytanie o konto.').success).toBe(true);
    expect(contentReportSchema.shape.details.safeParse('Oferta wygląda na oszustwo.').success).toBe(true);
    expect(contentReportSchema.shape.contentUrl.safeParse('https://pracuj.be/oferty?x=1').success).toBe(true);
    expect(companyDescriptionSchema.shape.description.safeParse('Firma logistyczna z Gandawy.').success).toBe(true);
  });
});

describe('wykrywanie domen bez złożoności kwadratowej', () => {
  function ms(fn: () => unknown): number {
    const t = performance.now();
    fn();
    return performance.now() - t;
  }
  // Wzorzec sprzed poprawki (message-excerpt.ts) — kontrola ujemna złożoności.
  const OLD_BARE_DOMAIN = /\b(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+(?:be|com)\b/gi;

  it('długi ciąg „a.a.a.…” w cytacie e-maila i w walidatorze tłumaczeń kończy się szybko', () => {
    const text = 'a.'.repeat(100_000);
    expect(ms(() => buildMessageExcerpt(text))).toBeLessThan(500);
    expect(ms(() => extractFacts(text, 'pl'))).toBeLessThan(1000);
  });

  it('kontrola ujemna: dawny wzorzec na 20× krótszym ciągu jest wolniejszy niż nowy na pełnym', () => {
    const full = 'a.'.repeat(100_000);
    const short = 'a.'.repeat(5_000);
    const fresh = ms(() => buildMessageExcerpt(full));
    const old = ms(() => short.replace(OLD_BARE_DOMAIN, ''));
    expect(old).toBeGreaterThan(fresh);
  });

  it('zwykłe domeny nadal wykrywane (cytat i fakty)', () => {
    expect(buildMessageExcerpt('Zobacz firma.be, sub.firma.be:8080 i praca.example.com/oferta teraz.')).toBe(
      `Zobacz ${EXCERPT_REDACTION}, ${EXCERPT_REDACTION} i ${EXCERPT_REDACTION} teraz.`,
    );
    expect(extractFacts('Aplikuj na jobs.firma.be/oferta albo a.b.c.d.example.com', 'pl').urls).toEqual([
      'a.b.c.d.example.com',
      'jobs.firma.be/oferta',
    ]);
  });
});

describe('zapis wyszukiwania spójny z listą ofert', () => {
  it('adres wyszukiwania z bardzo długim słowem jest ucięty jak filtr i mieści się w limicie', () => {
    const query = parseJobListQuery({ keyword: 'k'.repeat(2500), city: 'c'.repeat(3000) }, 'pl');
    const qs = savedSearchQueryString(query);
    const params = new URLSearchParams(qs.slice(1));
    expect(params.get('keyword')).toBe(savedSearchFiltersFromQuery(query).keyword);
    expect(params.get('city')).toHaveLength(100);
    expect(savedSearchExceedsLimits(savedSearchFiltersFromQuery(query), qs)).toBe(false);
  });

  it('za dużo lokalizacji albo za długa nazwa miasta = jawny komunikat zamiast ogólnego błędu', () => {
    const many = parseJobListQuery({ location: Array.from({ length: 60 }, (_, i) => `Miasto${i}`).join(',') }, 'pl');
    expect(savedSearchExceedsLimits(savedSearchFiltersFromQuery(many), savedSearchQueryString(many))).toBe(true);
    const long = parseJobListQuery({ location: 'x'.repeat(150) }, 'pl');
    expect(savedSearchExceedsLimits(savedSearchFiltersFromQuery(long), savedSearchQueryString(long))).toBe(true);
    expect(savedSearchExceedsLimits({ keyword: 'a' }, `?${'x'.repeat(2001)}`)).toBe(true);
  });

  it('kontrola ujemna: zwykłe wyszukiwanie (10 miast z aliasami, 2000 znaków adresu) mieści się w limitach', () => {
    const cities = ['Brussels', 'Antwerp', 'Ghent', 'Liège', 'Charleroi', 'Leuven', 'Bruges', 'Namur', 'Mechelen', 'Hasselt'];
    const query = parseJobListQuery({ location: cities.join(','), keyword: 'magazyn' }, 'pl');
    expect(savedSearchExceedsLimits(savedSearchFiltersFromQuery(query), savedSearchQueryString(query))).toBe(false);
    // Limit adresu liczony w punktach kodowych jak `char_length` (emoji = 1 znak).
    expect(savedSearchExceedsLimits({ keyword: 'a' }, `?${'😀'.repeat(1999)}`)).toBe(false);
  });

  it('przycisk przy przekroczonych limitach pokazuje prośbę o zawężenie filtrów, bez przycisku zapisu', () => {
    const wrap = (exceedsLimits: boolean) => (
      <NextIntlClientProvider locale="pl" messages={pl}>
        <SaveSearchButton
          locale="pl"
          filters={{ keyword: 'a' }}
          query="?keyword=a"
          name="A"
          loginNext="/oferty-pracy"
          exceedsLimits={exceedsLimits}
        />
      </NextIntlClientProvider>
    );
    const { rerender } = render(wrap(true));
    expect(screen.getByText(pl.savedSearches.tooManyFilters)).toBeTruthy();
    expect(screen.queryByRole('button', { name: pl.savedSearches.save })).toBeNull();
    // Kontrola ujemna: w limitach przycisk jest.
    rerender(wrap(false));
    expect(screen.getByRole('button', { name: pl.savedSearches.save })).toBeTruthy();
    expect(screen.queryByText(pl.savedSearches.tooManyFilters)).toBeNull();
  });
});
