import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

vi.mock('@/lib/actions/notification-preferences', () => ({ updateNotificationPreferences: vi.fn() }));
// Tryb demo: backend nieskonfigurowany (atrapa `@/lib/db/portal` z configured = false).
vi.mock('@/lib/db/portal', async () => {
  const fake = await import('../helpers/fake-db');
  fake.resetFakeDb(null);
  fake.fakeSession.configured = false;
  fake.fakeSession.serviceConfigured = false;
  return fake.fakePortal();
});
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: 'pl' | 'nl' | 'fr' | 'en'; namespace: string }) =>
    (key: string) =>
      ({ pl, nl, fr, en }[locale] as unknown as Record<string, Record<string, string>>)[namespace]![key],
}));

import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/data/notification-preferences';
import { getNotifications } from '@/lib/data/notifications';

const translations = { pl, nl, fr, en } as const;
type Loc = keyof typeof translations;

afterEach(cleanup);

// jsdom nie ma ResizeObserver (używa go Radix Checkbox).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function renderForm(locale: Loc, role?: 'candidate' | 'employer') {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <NotificationPreferencesForm defaultValues={DEFAULT_NOTIFICATION_PREFERENCES} role={role} />
    </NextIntlClientProvider>,
  );
}

describe('ustawienia powiadomień wg roli (#357)', () => {
  it.each(['pl', 'nl', 'fr', 'en'] as const)('pracodawca: opisy z perspektywy firmy, bez dopasowanych ofert (%s)', (locale) => {
    const s = translations[locale].settings;
    renderForm(locale, 'employer');
    expect(screen.getByRole('checkbox', { name: s.emailOffersLabel })).toHaveAccessibleDescription(
      s.employerEmailOffersDescription,
    );
    expect(screen.getByRole('checkbox', { name: s.emailApplicationsLabel })).toHaveAccessibleDescription(
      s.employerEmailApplicationsDescription,
    );
    expect(screen.queryByRole('checkbox', { name: s.emailJobMatchesLabel })).not.toBeInTheDocument();
    expect(screen.queryByText(s.emailOffersDescription)).not.toBeInTheDocument();
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)('kandydat bez zmian (%s)', (locale) => {
    const s = translations[locale].settings;
    renderForm(locale);
    expect(screen.getByRole('checkbox', { name: s.emailOffersLabel })).toHaveAccessibleDescription(
      s.emailOffersDescription,
    );
    expect(screen.getByRole('checkbox', { name: s.emailJobMatchesLabel })).toBeInTheDocument();
  });

  it.each(['candidate', 'employer'] as const)('każdy przełącznik ma opis dostępny (%s)', (role) => {
    renderForm('pl', role);
    const boxes = screen.getAllByRole('checkbox');
    expect(boxes.length).toBeGreaterThan(0);
    for (const box of boxes) expect(box).toHaveAccessibleDescription(/\S/);
  });
});

describe('powiadomienia demo (#359)', () => {
  it('czas w języku strony przez Intl.RelativeTimeFormat', async () => {
    const result = await getNotifications('fr', 'employer');
    if (result.status !== 'ready') throw new Error('expected ready');
    expect(result.items[0]!.meta).toBe('il y a 10 minutes');
    expect(result.items[0]!.title).toBe(fr.notifications.itemJobMatch);
    expect(result.items.every((item) => item.href.startsWith('/employer'))).toBe(true);
  });
});
