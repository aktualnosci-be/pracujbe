import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SavedSearchList } from '@/components/candidate/SavedSearchList';
import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/data/notification-preferences';
import { setSavedSearchAlertsAction } from '@/lib/actions/saved-searches';
import { updateNotificationPreferences } from '@/lib/actions/notification-preferences';
import { captureFocus } from '@/lib/a11y/restore-focus';
import pl from '@/messages/pl.json';

/**
 * #1095 (A11Y-05) — po akcji, która na czas zapisu wyłącza aktywną kontrolkę, fokus nie może
 * zostać na `<body>`. #1103 (UX13-06) — „Zapisano” nie zostaje widoczne po kolejnej,
 * jeszcze niewysłanej zmianie przełączników.
 *
 * jsdom nie odtwarza gubienia fokusu przy `disabled`, więc atrapa akcji robi to, co
 * przeglądarka: `blur()` aktywnego elementu w trakcie zapisu.
 */

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh }),
  Link: ({ href, locale: _l, children, ...rest }: { href: string; locale?: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/actions/saved-searches', () => ({
  renameSavedSearchAction: vi.fn(),
  setSavedSearchAlertsAction: vi.fn(),
  deleteSavedSearchAction: vi.fn(),
}));
vi.mock('@/lib/actions/notification-preferences', () => ({ updateNotificationPreferences: vi.fn() }));

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const SEARCH = {
  id: '5a6b7c8d-1e2f-4a3b-8c4d-5e6f7a8b9c0d',
  name: 'Magazyn Liège',
  query: '?category=warehouse',
  locale: 'pl' as const,
  frequency: 'daily' as const,
  alertsEnabled: true,
  lastAlertAt: null,
  createdAt: '2026-09-24T10:00:00Z',
  lastAlertLabel: null,
};

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="pl" messages={pl}>
    {node}
  </NextIntlClientProvider>
);

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

/**
 * Odtwarza zachowanie przeglądarki: aktywny element wyłączony na czas zapisu traci fokus
 * (`document.activeElement` = `<body>`), dopóki ktoś jawnie nie wywoła na nim `focus()`.
 * (jsdom ignoruje `blur()` na wyłączonym elemencie, więc nadpisujemy getter.)
 */
function loseFocusDuringSave<T>(result: T): Promise<T> {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) {
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => document.body });
    const originalFocus = el.focus.bind(el);
    el.focus = () => {
      delete (document as unknown as Record<string, unknown>).activeElement;
      el.focus = originalFocus;
      originalFocus();
    };
  }
  return Promise.resolve(result);
}

afterEach(() => {
  delete (document as unknown as Record<string, unknown>).activeElement;
});

describe('captureFocus', () => {
  it('przywraca fokus tylko gdy spadł na body', async () => {
    render(<button type="button">a</button>);
    const btn = screen.getByRole('button', { name: 'a' });
    btn.focus();
    const restore = captureFocus();
    btn.blur();
    restore();
    await waitFor(() => expect(btn).toHaveFocus());
  });

  it('kontrola ujemna: nie nadpisuje fokusu ustawionego celowo gdzie indziej', async () => {
    render(
      <>
        <button type="button">a</button>
        <button type="button">b</button>
      </>,
    );
    const a = screen.getByRole('button', { name: 'a' });
    const b = screen.getByRole('button', { name: 'b' });
    a.focus();
    const restore = captureFocus();
    b.focus();
    restore();
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(b).toHaveFocus();
  });

  it('kontrola ujemna: bez captureFocus fokus zostaje na body', async () => {
    render(<button type="button">a</button>);
    const btn = screen.getByRole('button', { name: 'a' });
    btn.focus();
    btn.blur();
    await act(async () => new Promise((r) => setTimeout(r, 30)));
    expect(document.body).toHaveFocus();
  });
});

describe('zapisane wyszukiwania: fokus po zmianie alertu / częstotliwości (#1095)', () => {
  it('checkbox alertu odzyskuje fokus po zapisie', async () => {
    vi.mocked(setSavedSearchAlertsAction).mockImplementation(() => loseFocusDuringSave({ ok: true }));
    render(wrap(<SavedSearchList currentLocale="pl" searches={[SEARCH]} />));
    const alerts = screen.getByRole('checkbox', { name: pl.savedSearches.alerts });
    alerts.focus();
    fireEvent.click(alerts);
    await waitFor(() => expect(setSavedSearchAlertsAction).toHaveBeenCalled());
    await waitFor(() => expect(alerts).toHaveFocus());
  });

  it('lista częstotliwości odzyskuje fokus po zapisie', async () => {
    vi.mocked(setSavedSearchAlertsAction).mockImplementation(() => loseFocusDuringSave({ ok: true }));
    render(wrap(<SavedSearchList currentLocale="pl" searches={[SEARCH]} />));
    const freq = screen.getByRole('combobox', { name: pl.savedSearches.frequency });
    freq.focus();
    fireEvent.change(freq, { target: { value: 'weekly' } });
    await waitFor(() => expect(freq).toHaveFocus());
  });
});

describe('preferencje powiadomień (#1095, #1103)', () => {
  const renderForm = () =>
    render(wrap(<NotificationPreferencesForm defaultValues={DEFAULT_NOTIFICATION_PREFERENCES} />));

  it('przycisk „Zapisz” odzyskuje fokus po zapisie', async () => {
    vi.mocked(updateNotificationPreferences).mockImplementation(() => loseFocusDuringSave({ ok: true }));
    renderForm();
    const save = screen.getByRole('button', { name: pl.settings.save });
    save.focus();
    fireEvent.click(save);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(pl.settings.savedSuccess));
    await waitFor(() => expect(save).toHaveFocus());
  });

  it('„Zapisano” znika przy następnej, jeszcze niewysłanej zmianie przełącznika', async () => {
    vi.mocked(updateNotificationPreferences).mockResolvedValue({ ok: true });
    renderForm();
    fireEvent.click(screen.getByRole('button', { name: pl.settings.save }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(pl.settings.savedSuccess));

    fireEvent.click(screen.getAllByRole('checkbox')[0]!);
    expect(screen.queryByText(pl.settings.savedSuccess)).not.toBeInTheDocument();

    // Ponowny zapis znowu pokazuje potwierdzenie.
    fireEvent.click(screen.getByRole('button', { name: pl.settings.save }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(pl.settings.savedSuccess));
  });
});
