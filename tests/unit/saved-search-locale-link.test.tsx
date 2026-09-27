import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import { mapSavedSearchRow, type SavedSearch } from '@/lib/data/saved-searches';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

/**
 * #823 — zapisane wyszukiwanie przechowuje locale użyty do dopasowania słowa kluczowego
 * (0092, `saved_search_canonical_filters`); worker alertów liczy oferty w TYM samym języku
 * (`get_public_jobs` → `p_locale => v_search.locale`). „Pokaż oferty” musi więc otworzyć listę
 * pod zapisanym locale, nie pod aktualnym językiem panelu — inaczej kandydat widzi inny zbiór
 * ofert niż ten objęty alertem.
 *
 * Mock `Link` tego pliku CELOWO nie odrzuca propa `locale` (w przeciwieństwie do innych testów
 * `SavedSearchList`) — zapisuje go jako atrybut `data-locale`, żeby dało się zweryfikować, pod
 * jakim językiem otwiera się link, niezależnie od bieżącego języka panelu.
 */

vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({
    href,
    locale,
    children,
    ...rest
  }: {
    href: string;
    locale?: string;
    children: React.ReactNode;
  }) => (
    <a href={href} data-locale={locale ?? ''} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/saved-searches', () => ({
  renameSavedSearchAction: vi.fn(),
  setSavedSearchAlertsAction: vi.fn(),
  deleteSavedSearchAction: vi.fn(),
}));

afterEach(cleanup);

const BASE: SavedSearch = {
  id: '5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  name: 'Magazyn Liège',
  query: '?category=warehouse&keyword=heftruck',
  locale: 'fr',
  frequency: 'daily',
  alertsEnabled: true,
  lastAlertAt: null,
  createdAt: '2026-09-24T10:00:00Z',
};

function renderList(search: Partial<SavedSearch> & { filterLabels?: string[] }, currentLocale: 'pl' | 'en' = 'pl') {
  const messages = currentLocale === 'en' ? en : pl;
  return render(
    <NextIntlClientProvider locale={currentLocale} messages={messages}>
      <SavedSearchList currentLocale={currentLocale} searches={[{ ...BASE, ...search, lastAlertLabel: null }]} />
    </NextIntlClientProvider>,
  );
}

describe('mapSavedSearchRow — locale zapisu (#823)', () => {
  it('zwraca obsługiwany locale z wiersza bazy', () => {
    expect(mapSavedSearchRow({ id: 'a', name: 'n', query: '?keyword=x', locale: 'nl' })).toMatchObject({
      locale: 'nl',
    });
  });

  it('kontrola ujemna: brak/nieobsługiwany locale w wierszu → bezpieczny fallback do domyślnego, nigdy dowolny ciąg', () => {
    expect(mapSavedSearchRow({ id: 'a', name: 'n', query: '?keyword=x' })).toMatchObject({ locale: 'pl' });
    expect(
      mapSavedSearchRow({ id: 'a', name: 'n', query: '?keyword=x', locale: 'de' }),
    ).toMatchObject({ locale: 'pl' });
    expect(
      mapSavedSearchRow({ id: 'a', name: 'n', query: '?keyword=x', locale: '<script>' }),
    ).toMatchObject({ locale: 'pl' });
  });
});

describe('SavedSearchList — „Pokaż oferty” otwiera locale zapisu, nie panelu (#823)', () => {
  it('locale zapisu (fr) różny od panelu (pl) → link otwiera się pod fr, nie pod pl', () => {
    renderList({ locale: 'fr' }, 'pl');
    const link = screen.getByRole('link', { name: new RegExp(`^${pl.savedSearches.open}`) });
    expect(link).toHaveAttribute('data-locale', 'fr');
  });

  it('ten sam locale zapisu i panelu → link nadal jawnie wskazuje ten locale', () => {
    renderList({ locale: 'pl' }, 'pl');
    const link = screen.getByRole('link', { name: new RegExp(`^${pl.savedSearches.open}`) });
    expect(link).toHaveAttribute('data-locale', 'pl');
  });

  it('locale zapisu różny od panelu i wyszukiwanie ma słowo kluczowe → widoczna notatka o języku', () => {
    renderList({ locale: 'fr', query: '?keyword=heftruck' }, 'pl');
    expect(screen.getByText(pl.savedSearches.openLocaleNote.replace('{language}', 'Français'))).toBeInTheDocument();
  });

  it('kontrola ujemna: bez słowa kluczowego w zapisie notatka o języku się nie pojawia mimo innego locale', () => {
    renderList({ locale: 'fr', query: '?category=warehouse' }, 'pl');
    expect(screen.queryByText(/Français/)).toBeNull();
  });

  it('kontrola ujemna: locale zapisu równy panelowi → notatka o języku się nie pojawia mimo słowa kluczowego', () => {
    renderList({ locale: 'pl', query: '?keyword=heftruck' }, 'pl');
    expect(screen.queryByText(pl.savedSearches.openLocaleNote.replace('{language}', 'Polski'))).toBeNull();
  });
});
