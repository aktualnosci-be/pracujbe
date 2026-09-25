import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  loadNotificationPreferences,
} from '@/lib/data/notification-preferences';
import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import CandidateSettingsPage from '@/app/[locale]/candidate/ustawienia/page';
import EmployerSettingsPage from '@/app/[locale]/employer/ustawienia/page';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';
import { updateNotificationPreferences } from '@/lib/actions/notification-preferences';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

const translations = { pl, nl, fr, en } as const;
type LocaleKey = keyof typeof translations;

const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('next-intl/server', () => ({
  setRequestLocale: vi.fn(),
  getTranslations: async ({ locale, namespace }: { locale: LocaleKey; namespace: string }) =>
    (key: string) =>
      (translations[locale] as unknown as Record<string, Record<string, string>>)[namespace]![key],
}));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
// Sekcja zablokowanych firm (#97) ma własne testy (company-blocks-action, E2E).
vi.mock('@/lib/data/company-blocks', () => ({
  loadMyCompanyBlocks: async () => ({ status: 'ready', blocks: [], demo: false }),
}));
vi.mock('@/components/settings/CompanyBlocksSettings', () => ({ CompanyBlocksSettings: () => null }));
// Widoczność profilu (#494) ma własne testy (profile-visibility, rls.sql VIS494).
vi.mock('@/lib/data/profile-visibility', () => ({
  loadProfileVisibility: async () => ({ status: 'ready', demo: false, searchable: false, completed: true, changedAt: null }),
}));
vi.mock('@/components/settings/ProfileVisibilitySettings', () => ({ ProfileVisibilitySettings: () => null }));
// Deklaracja wieku (#492) ma własne testy (age-attestation, rls.sql AGE492).
vi.mock('@/lib/data/age-policy', () => ({
  loadMyAgeAttestation: async () => ({ status: 'ready', demo: false, requiredMinAge: 18, attestedMinAge: 18, meetsPolicy: true }),
}));
vi.mock('@/components/settings/AgeAttestationSettings', () => ({ AgeAttestationSettings: () => null }));
vi.mock('@/lib/actions/notification-preferences', () => ({
  updateNotificationPreferences: vi.fn(),
}));

const SELF = '3a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';

/** Sesja użytkownika + wynik zapytania o własny wiersz preferencji (albo błąd bazy). */
function setupSession(result: { data?: unknown; error?: unknown; user?: { id: string } | null }) {
  resetFakeDb(result.user === null ? null : { id: result.user?.id ?? SELF, role: 'candidate' });
  fakeDb.rows('notification-preferences.own', () => {
    if (result.error) throw pgError('XX000', 'boom');
    return result.data ? [result.data] : [];
  });
}

// jsdom nie ma ResizeObserver (używa go Radix Checkbox).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom nie implementuje scrollIntoView (formularz przewija do komunikatu).
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('loadNotificationPreferences (#309)', () => {
  it('błąd odczytu daje stan błędu, a nie wartości domyślne', async () => {
    setupSession({ error: { message: 'boom' } });
    await expect(loadNotificationPreferences()).resolves.toEqual({ status: 'error' });
  });

  it('wyjątek połączenia daje stan błędu', async () => {
    setupSession({});
    fakeDb.rows('notification-preferences.own', () => {
      throw new Error('network');
    });
    await expect(loadNotificationPreferences()).resolves.toEqual({ status: 'error' });
  });

  it('brak sesji daje stan błędu (bez formularza) i bez zapytania', async () => {
    setupSession({ user: null });
    await expect(loadNotificationPreferences()).resolves.toEqual({ status: 'error' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('zapytanie zawężone do własnego profilu, pod sesją (nie service-role)', async () => {
    setupSession({ data: null });
    await loadNotificationPreferences();
    const [call] = fakeDb.callsTo('notification-preferences.own');
    expect(call?.as).toBe(SELF);
    expect(call?.values).toEqual([SELF]);
  });

  it('tryb demo (bez backendu) → wartości domyślne bez zapytań', async () => {
    resetFakeDb(null);
    fakeSession.configured = false;
    await expect(loadNotificationPreferences()).resolves.toEqual({
      status: 'ready',
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('brak wiersza daje wartości domyślne jako stan gotowy', async () => {
    setupSession({ data: null });
    await expect(loadNotificationPreferences()).resolves.toEqual({
      status: 'ready',
      preferences: DEFAULT_NOTIFICATION_PREFERENCES,
    });
  });

  it('zapisany wiersz zachowuje opt-outy użytkownika', async () => {
    setupSession({
      data: {
        email_applications: true,
        email_offers: true,
        email_messages: false,
        email_job_matches: false,
        email_marketing: false,
        push_enabled: true,
        in_app_enabled: true,
      },
    });
    const load = await loadNotificationPreferences();
    expect(load).toMatchObject({
      status: 'ready',
      preferences: { emailMessages: false, emailJobMatches: false, pushEnabled: true },
    });
  });
});

async function renderPage(
  Page: typeof CandidateSettingsPage,
  locale: LocaleKey,
): Promise<void> {
  const element = await Page({ params: Promise.resolve({ locale }) });
  render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      {element}
    </NextIntlClientProvider>,
  );
}

describe('ekran ustawień przy błędzie odczytu (#309)', () => {
  it.each([
    ['kandydat', CandidateSettingsPage],
    ['pracodawca', EmployerSettingsPage],
  ] as const)('%s: pokazuje błąd z ponowieniem i nie pokazuje formularza', async (_, Page) => {
    for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
      setupSession({ error: { message: 'boom' } });
      await renderPage(Page, locale);
      const m = translations[locale];

      expect(screen.getByRole('alert')).toHaveTextContent(m.settings.loadError);
      expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: m.settings.save })).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: m.common.retry }));
      expect(refresh).toHaveBeenCalledOnce();
      refresh.mockClear();
      cleanup();
    }
  });

  it('po udanym odczycie pokazuje formularz z zapisanymi wartościami', async () => {
    setupSession({ data: { email_job_matches: false } });
    await renderPage(CandidateSettingsPage, 'pl');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(document.getElementById('pref-emailJobMatches')).toHaveAttribute('data-state', 'unchecked');
    expect(screen.getByRole('button', { name: pl.settings.save })).toBeEnabled();
  });
});

describe('przełącznik push (#312)', () => {
  it('formularz nie renderuje kontrolki push i zapis nie zmienia jej wartości', async () => {
    vi.mocked(updateNotificationPreferences).mockResolvedValue({ ok: true });
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <NotificationPreferencesForm
          defaultValues={{ ...DEFAULT_NOTIFICATION_PREFERENCES, pushEnabled: true }}
        />
      </NextIntlClientProvider>,
    );

    expect(document.getElementById('pref-pushEnabled')).toBeNull();
    expect(document.getElementById('pref-inAppEnabled')).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: pl.settings.save }));
    await waitFor(() => expect(updateNotificationPreferences).toHaveBeenCalledOnce());
    expect(vi.mocked(updateNotificationPreferences).mock.calls[0]![0]).toMatchObject({
      pushEnabled: true,
      // #45: język strony i rola wyznaczają wersję treści zgody w dowodzie.
      locale: 'pl',
      role: 'candidate',
    });
  });
});
