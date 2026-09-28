import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployerNotFound } from '@/components/employer/EmployerNotFound';
import { EmployerPanelError } from '@/components/employer/EmployerPanelError';
import { captureError } from '@/lib/error-report';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
// Alias: nazwa `use*` myli regułę react-hooks/rules-of-hooks (to nie hook Reacta, tylko beforeEach/afterEach).
import { withRecruitmentMode as recruitmentModeInTests } from '../helpers/portal-mode';

// Istniejące przepływy rekrutacyjne testowane w trybie RECRUITMENT (#1128, tryb ogłoszeniowy = domyślny).
recruitmentModeInTests();

/**
 * Granica błędu i strona 404 panelu pracodawcy leżą POD layoutem `/employer` (chrome panelu
 * zostaje). Komunikaty z i18n w 4 językach, bez treści wyjątku (Invariant #8), ponowienie
 * pobiera świeże dane serwera, 404 prowadzi do sekcji panelu, nie do stron publicznych.
 */

const locales = [['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const;
type Messages = typeof pl;

const calls: string[] = [];
const refresh = vi.fn(() => calls.push('refresh'));
let currentLocale = 'pl';
let currentMessages: Messages = pl;

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getLocale: async () => currentLocale,
  getTranslations: async ({ namespace }: { namespace: string }) =>
    createTranslator({ locale: currentLocale, messages: currentMessages, namespace: namespace as never }),
}));

beforeEach(() => {
  calls.length = 0;
  refresh.mockClear();
  vi.mocked(captureError).mockClear();
});
afterEach(cleanup);

describe('EmployerPanelError', () => {
  it.each(locales)('%s: komunikat z i18n, ponowienie refresh + reset, link do pulpitu', (locale, messages) => {
    const reset = vi.fn(() => calls.push('reset'));
    const error = Object.assign(new Error('SELECT * FROM applications WHERE phone = +32470'), { digest: 'd1' });
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <EmployerPanelError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 1, name: messages.dashboard.employerPanelErrorTitle })).toBeTruthy();
    expect(within(alert).getByText(messages.dashboard.employerPanelErrorBody)).toBeTruthy();
    expect(
      within(alert).getByRole('link', { name: messages.dashboard.employerPanelBackToDashboard }).getAttribute('href'),
    ).toBe('/employer');
    // Treść wewnątrz <main> DashboardShell — bez drugiego landmarku.
    expect(container.querySelector('main')).toBeNull();
    // Invariant #8: treść wyjątku nie trafia do UI.
    expect(container.textContent).not.toContain('SELECT');
    expect(container.textContent).not.toContain('+32470');

    fireEvent.click(within(alert).getByRole('button', { name: messages.common.retry }));
    expect(calls).toEqual(['refresh', 'reset']);
    expect(captureError).toHaveBeenCalledWith(error, { area: 'employer.error-boundary', digest: 'd1' });
  });
});

describe('EmployerNotFound', () => {
  it.each(locales)('%s: 404 z linkami do sekcji panelu', async (locale, messages) => {
    currentLocale = locale;
    currentMessages = messages;
    const { container } = render(await EmployerNotFound());

    expect(screen.getByRole('heading', { level: 1, name: messages.dashboard.employerNotFoundTitle })).toBeTruthy();
    expect(screen.getByText(messages.dashboard.employerNotFoundBody)).toBeTruthy();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(hrefs).toEqual(['/employer', '/employer/aplikacje', '/employer/oferty']);
    // Kontrola ujemna: żadnego linku publicznego („Oferty pracy”, „Strona główna”).
    expect(hrefs).not.toContain('/');
    expect(hrefs).not.toContain('/oferty-pracy');
    expect(container.querySelector('main')).toBeNull();
    // React 19 przenosi <title> do <head>.
    expect(document.head.querySelector('title')?.textContent).toBe(
      `${messages.dashboard.employerNotFoundTitle} · ${messages.common.appName}`,
    );
  });
});

describe('pliki granic w segmencie /employer', () => {
  // Granica w `src/app/[locale]/` leży nad layoutem panelu i zastępuje cały chrome — plik
  // w segmencie `employer` jest warunkiem, żeby sidebar i przełącznik firmy zostały.
  const dir = resolve(process.cwd(), 'src/app/[locale]/employer');

  it('error.tsx jest komponentem klienta i eksportuje granicę panelu', () => {
    const file = resolve(dir, 'error.tsx');
    expect(existsSync(file)).toBe(true);
    const source = readFileSync(file, 'utf8');
    expect(source.trimStart().startsWith('"use client"') || source.trimStart().startsWith("'use client'")).toBe(true);
    expect(source).toContain('EmployerPanelError as default');
  });

  it('not-found.tsx eksportuje 404 panelu', () => {
    const file = resolve(dir, 'not-found.tsx');
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, 'utf8')).toContain('EmployerNotFound as default');
  });
});
