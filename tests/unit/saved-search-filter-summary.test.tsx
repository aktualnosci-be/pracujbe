import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import {
  describeJobListFilters,
  savedSearchFilterLabels,
  type FilterSummaryTranslators,
} from '@/lib/job-filter-summary';
import { parseJobListQuery, savedSearchQueryString } from '@/lib/job-list-query';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';

/**
 * #100 — zapisane wyszukiwanie pokazuje swoje filtry w języku widza. Etykiety pochodzą
 * z tego samego źródła co chipy `/oferty-pracy` (`describeJobListFilters`), więc po zmianie
 * nazwy wyszukiwania albo języka panelu kandydat nadal widzi, czego dotyczy alert.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, locale: _locale, children, ...rest }: { href: string; locale?: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/saved-searches', () => ({
  renameSavedSearchAction: vi.fn(),
  setSavedSearchAlertsAction: vi.fn(),
  deleteSavedSearchAction: vi.fn(),
}));

afterEach(cleanup);

const MESSAGES = { pl, en, fr, nl } as const;
type Locale = keyof typeof MESSAGES;

function translators(locale: Locale): FilterSummaryTranslators {
  const messages = MESSAGES[locale];
  const make = (namespace: 'filters' | 'categories' | 'contractTypes' | 'languageNames' | 'jobBenefits') => {
    const t = createTranslator({ locale, messages, namespace });
    return (key: string, values?: Record<string, string | number>) =>
      (t as unknown as (k: string, v?: Record<string, string | number>) => string)(key, values);
  };
  return {
    filters: make('filters'),
    categories: make('categories'),
    contractTypes: make('contractTypes'),
    languageNames: make('languageNames'),
    benefits: make('jobBenefits'),
  };
}

const QUERY =
  '?category=warehouse&contractType=interim&salaryMin=2500&accommodation=provided&immediate=1&noLang=1&keyword=heftruck';

describe('describeJobListFilters / savedSearchFilterLabels', () => {
  it('etykiety w języku widza — w każdym z 4 języków z plików tłumaczeń', () => {
    for (const locale of Object.keys(MESSAGES) as Locale[]) {
      const m = MESSAGES[locale];
      const labels = savedSearchFilterLabels(QUERY, locale, translators(locale));
      expect(labels[0]).toBe('heftruck');
      expect(labels).toContain(m.categories.warehouse);
      expect(labels).toContain(m.contractTypes.interim);
      expect(labels).toContain(m.filters.provided);
      expect(labels).toContain(m.filters.immediate);
      expect(labels).toContain(m.filters.noLanguageRequired);
      const eur = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
      expect(labels.some((label) => label.includes(eur.format(2500)))).toBe(true);
    }
  });

  it('ten sam zapis czytany po polsku i po angielsku daje różne etykiety (nie nazwę z zapisu)', () => {
    const plLabels = savedSearchFilterLabels('?category=warehouse', 'pl', translators('pl'));
    const enLabels = savedSearchFilterLabels('?category=warehouse', 'en', translators('en'));
    expect(plLabels).toEqual([pl.categories.warehouse]);
    expect(enLabels).toEqual([en.categories.warehouse]);
    expect(plLabels).not.toEqual(enLabels);
  });

  it('świeżość (date) nie jest zapisanym filtrem — lista jej nie pokazuje, chipy listy tak', () => {
    const q = parseJobListQuery({ category: 'warehouse', date: '7d' }, 'pl');
    const chips = describeJobListFilters(q, 'pl', translators('pl'));
    expect(chips.map((c) => c.id)).toEqual(['cat-warehouse', 'date']);
    expect(savedSearchFilterLabels('?category=warehouse&date=7d', 'pl', translators('pl'))).toEqual([
      pl.categories.warehouse,
    ]);
  });

  it('parametry usuwania chipów odpowiadają parametrom adresu listy', () => {
    const q = parseJobListQuery(
      { keyword: 'x', category: 'warehouse', contractType: 'interim', salaryMin: '2500', noLang: '1' },
      'pl',
    );
    const items = describeJobListFilters(q, 'pl', translators('pl'));
    expect(items.map((i) => [i.removeKey, i.removeValue ?? null])).toEqual([
      ['keyword', null],
      ['category', 'warehouse'],
      ['contractType', 'interim'],
      ['salary', null],
      ['noLang', null],
    ]);
  });

  it('zapis z listy i odczyt w panelu dają te same etykiety co chipy (bez daty)', () => {
    const flat = { category: 'warehouse', immediate: '1', date: '24h' };
    const listQuery = parseJobListQuery(flat, 'nl');
    const chipLabels = describeJobListFilters(listQuery, 'nl', translators('nl'))
      .filter((c) => c.id !== 'date')
      .map((c) => c.label);
    expect(savedSearchFilterLabels(savedSearchQueryString(listQuery), 'nl', translators('nl'))).toEqual(chipLabels);
  });

  it('pusty albo nieprawidłowy adres = brak etykiet (kontrola ujemna)', () => {
    expect(savedSearchFilterLabels('', 'pl', translators('pl'))).toEqual([]);
    expect(savedSearchFilterLabels('category=warehouse', 'pl', translators('pl'))).toEqual([]);
    expect(savedSearchFilterLabels('?category=nieistnieje', 'pl', translators('pl'))).toEqual([]);
  });
});

const SEARCH = {
  id: '5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  name: 'Moja nazwa',
  query: '?category=warehouse&immediate=1',
  locale: 'pl' as const,
  frequency: 'daily' as const,
  alertsEnabled: true,
  lastAlertAt: null,
  createdAt: '2026-09-24T10:00:00Z',
  lastAlertLabel: null,
};

describe('SavedSearchList — filtry przy wyszukiwaniu', () => {
  it('lista nazwana nazwą wyszukiwania, po jednej pozycji na filtr', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <SavedSearchList
          currentLocale="en"
          searches={[{ ...SEARCH, filterLabels: savedSearchFilterLabels(SEARCH.query, 'en', translators('en')) }]}
        />
      </NextIntlClientProvider>,
    );
    const list = screen.getByRole('list', {
      name: en.savedSearches.filtersLabel.replace('{name}', SEARCH.name),
    });
    const items = within(list).getAllByRole('listitem').map((li) => li.textContent);
    expect(items).toEqual([en.categories.warehouse, en.filters.immediate]);
  });

  it('bez etykiet nie renderuje pustej listy (kontrola ujemna)', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <SavedSearchList currentLocale="pl" searches={[{ ...SEARCH, filterLabels: [] }]} />
      </NextIntlClientProvider>,
    );
    expect(
      screen.queryByRole('list', { name: pl.savedSearches.filtersLabel.replace('{name}', SEARCH.name) }),
    ).toBeNull();
  });
});
