import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import { renameSavedSearchAction } from '@/lib/actions/saved-searches';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

/**
 * #100 — zmiana nazwy zapisanego wyszukiwania w `/candidate/wyszukiwania`: pole z etykietą
 * i podpowiedzią limitu, zapis przez akcję, komunikat w regionie statusu, błąd w `alert`,
 * Escape/„Anuluj” bez zapisu, fokus wraca na „Zmień nazwę”.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/saved-searches', () => ({
  renameSavedSearchAction: vi.fn(),
  setSavedSearchAlertsAction: vi.fn(),
  deleteSavedSearchAction: vi.fn(),
}));

const SEARCH = {
  id: '5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  name: 'Magazyn Liège',
  query: '?category=warehouse',
  frequency: 'daily' as const,
  alertsEnabled: true,
  lastAlertAt: null,
  createdAt: '2026-09-24T10:00:00Z',
  lastAlertLabel: null,
};

function renderList(locale: 'pl' | 'en' = 'pl') {
  return render(
    <NextIntlClientProvider locale={locale} messages={locale === 'pl' ? pl : en}>
      <SavedSearchList searches={[SEARCH]} />
    </NextIntlClientProvider>,
  );
}

const t = pl.savedSearches;
const renameButton = () => screen.getByRole('button', { name: new RegExp(`^${t.rename}\\s*:\\s*${SEARCH.name}$`) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(renameSavedSearchAction).mockResolvedValue({ ok: true });
});
afterEach(cleanup);

describe('zmiana nazwy zapisanego wyszukiwania', () => {
  it('pole z etykietą i limitem, zapis przez akcję, komunikat w regionie statusu', async () => {
    renderList();
    fireEvent.click(renameButton());
    const input = screen.getByRole('textbox', { name: t.renameLabel });
    expect(input).toHaveValue(SEARCH.name);
    expect(input).toHaveAttribute('maxLength', '80');
    expect(input).toHaveAccessibleDescription(t.renameHint);
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: 'Magazyn nocny' } });
    fireEvent.click(screen.getByRole('button', { name: t.renameSave }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(t.renamed));
    expect(renameSavedSearchAction).toHaveBeenCalledWith(SEARCH.id, 'Magazyn nocny');
    expect(refresh).toHaveBeenCalled();
    expect(screen.queryByRole('textbox', { name: t.renameLabel })).toBeNull();
  });

  it('błąd zapisu → komunikat w alert, pole zostaje z wpisaną nazwą (Invariant #11)', async () => {
    vi.mocked(renameSavedSearchAction).mockResolvedValue({ ok: false, error: 'NOT_FOUND' });
    renderList();
    fireEvent.click(renameButton());
    const input = screen.getByRole('textbox', { name: t.renameLabel });
    fireEvent.change(input, { target: { value: 'Nowa' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByRole('alert')).not.toBeEmptyDOMElement());
    expect(screen.getByRole('textbox', { name: t.renameLabel })).toHaveValue('Nowa');
    expect(refresh).not.toHaveBeenCalled();
  });

  it('KONTROLA UJEMNA: Escape i „Anuluj” nie zapisują, fokus wraca na „Zmień nazwę”', async () => {
    renderList();
    fireEvent.click(renameButton());
    fireEvent.keyDown(screen.getByRole('textbox', { name: t.renameLabel }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: t.renameLabel })).toBeNull();
    await waitFor(() => expect(renameButton()).toHaveFocus());

    fireEvent.click(renameButton());
    fireEvent.click(screen.getByRole('button', { name: t.renameCancel }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(renameSavedSearchAction).not.toHaveBeenCalled();
  });

  it('teksty w języku strony (en)', () => {
    renderList('en');
    const row = screen.getByRole('listitem');
    fireEvent.click(within(row).getByRole('button', { name: new RegExp(`^${en.savedSearches.rename}\\s*:\\s*${SEARCH.name}$`) }));
    expect(screen.getByRole('textbox', { name: en.savedSearches.renameLabel })).toBeVisible();
    expect(screen.getByRole('button', { name: en.savedSearches.renameSave })).toBeVisible();
  });
});
