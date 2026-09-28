import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { AdminNotFound } from '@/components/admin/AdminNotFound';
import { AdminPanelError } from '@/components/admin/AdminPanelError';
import { CandidateNotFound } from '@/components/candidate/CandidateNotFound';
import { CandidatePanelError } from '@/components/candidate/CandidatePanelError';
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
 * Granice błędu i strony 404 paneli kandydata i administratora leżą POD layoutem panelu
 * (chrome zostaje). Komunikaty z i18n w 4 językach, bez treści wyjątku (Invariant #8), do
 * kanału błędów sam błąd z obszarem i digestem, ponowienie pobiera świeże dane serwera, 404
 * prowadzi do sekcji panelu, nie do stron publicznych. Guard roli admina NIE zmienia się:
 * `notFound()` z layoutu łapie granica nadrzędna (sprawdzane na źródle layoutu).
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

const SECRET = 'SELECT * FROM applications WHERE phone = +32470';

function expectNoLeak(container: HTMLElement) {
  expect(container.textContent).not.toContain('SELECT');
  expect(container.textContent).not.toContain('+32470');
}

describe('CandidatePanelError', () => {
  it.each(locales)('%s: komunikat z i18n, ponowienie refresh + reset, link do pulpitu', (locale, messages) => {
    const reset = vi.fn(() => calls.push('reset'));
    const error = Object.assign(new Error(SECRET), { digest: 'c1' });
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <CandidatePanelError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );

    const alert = screen.getByRole('alert');
    expect(
      within(alert).getByRole('heading', { level: 1, name: messages.dashboard.candidatePanelErrorTitle }),
    ).toBeTruthy();
    expect(within(alert).getByText(messages.dashboard.candidatePanelErrorBody)).toBeTruthy();
    expect(
      within(alert).getByRole('link', { name: messages.dashboard.candidatePanelBackToDashboard }).getAttribute('href'),
    ).toBe('/candidate');
    expect(container.querySelector('main')).toBeNull();
    expectNoLeak(container);

    fireEvent.click(within(alert).getByRole('button', { name: messages.common.retry }));
    expect(calls).toEqual(['refresh', 'reset']);
    expect(captureError).toHaveBeenCalledWith(error, { area: 'candidate.error-boundary', digest: 'c1' });
  });
});

describe('AdminPanelError', () => {
  it.each(locales)('%s: komunikat z i18n, ponowienie refresh + reset, link do podsumowania', (locale, messages) => {
    const reset = vi.fn(() => calls.push('reset'));
    const error = Object.assign(new Error(SECRET), { digest: 'a1' });
    const { container } = render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AdminPanelError error={error} reset={reset} />
      </NextIntlClientProvider>,
    );

    const alert = screen.getByRole('alert');
    expect(within(alert).getByRole('heading', { level: 1, name: messages.admin.panelErrorTitle })).toBeTruthy();
    expect(within(alert).getByText(messages.admin.panelErrorBody)).toBeTruthy();
    expect(
      within(alert).getByRole('link', { name: messages.admin.panelBackToSummary }).getAttribute('href'),
    ).toBe('/admin');
    expect(container.querySelector('main')).toBeNull();
    expectNoLeak(container);

    fireEvent.click(within(alert).getByRole('button', { name: messages.common.retry }));
    expect(calls).toEqual(['refresh', 'reset']);
    expect(captureError).toHaveBeenCalledWith(error, { area: 'admin.error-boundary', digest: 'a1' });
  });
});

describe('CandidateNotFound', () => {
  it.each(locales)('%s: 404 z linkami do sekcji panelu kandydata', async (locale, messages) => {
    currentLocale = locale;
    currentMessages = messages;
    const { container } = render(await CandidateNotFound());

    expect(screen.getByRole('heading', { level: 1, name: messages.dashboard.candidateNotFoundTitle })).toBeTruthy();
    expect(screen.getByText(messages.dashboard.candidateNotFoundBody)).toBeTruthy();
    const links = screen.getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/candidate',
      '/candidate/aplikacje',
      '/candidate/wyszukiwania',
    ]);
    expect(links.map((a) => a.textContent)).toEqual([
      messages.dashboard.candidatePanelBackToDashboard,
      messages.dashboard.navApplications,
      messages.dashboard.navSearches,
    ]);
    // Kontrola ujemna: żadnego linku publicznego ani do panelu pracodawcy.
    for (const href of links.map((a) => a.getAttribute('href') ?? '')) {
      expect(href.startsWith('/candidate')).toBe(true);
    }
    expect(container.querySelector('main')).toBeNull();
    expect(document.head.querySelector('title')?.textContent).toBe(
      `${messages.dashboard.candidateNotFoundTitle} · ${messages.common.appName}`,
    );
  });
});

describe('AdminNotFound', () => {
  it.each(locales)('%s: 404 z linkami do sekcji panelu admina', async (locale, messages) => {
    currentLocale = locale;
    currentMessages = messages;
    const { container } = render(await AdminNotFound());

    expect(screen.getByRole('heading', { level: 1, name: messages.admin.panelNotFoundTitle })).toBeTruthy();
    expect(screen.getByText(messages.admin.panelNotFoundBody)).toBeTruthy();
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs).toEqual(['/admin', '/admin/firmy', '/admin/zgloszenia']);
    for (const href of hrefs) expect(href.startsWith('/admin')).toBe(true);
    expect(container.querySelector('main')).toBeNull();
  });
});

describe('teksty paneli są własne (bez kolizji z panelem pracodawcy)', () => {
  it.each(locales)('%s: klucze kandydata i admina niepuste i różne od ogólnej 404', (_locale, messages) => {
    const values = [
      messages.dashboard.candidatePanelErrorTitle,
      messages.dashboard.candidatePanelErrorBody,
      messages.dashboard.candidateNotFoundTitle,
      messages.dashboard.candidateNotFoundBody,
      messages.admin.panelErrorTitle,
      messages.admin.panelErrorBody,
      messages.admin.panelNotFoundTitle,
      messages.admin.panelNotFoundBody,
    ];
    for (const v of values) expect(v.trim().length).toBeGreaterThan(0);
    expect(messages.admin.panelNotFoundTitle).not.toBe(messages.errors.notFound);
    expect(messages.dashboard.candidateNotFoundTitle).not.toBe(messages.errors.notFound);
  });
});

describe('pliki granic w segmentach /candidate i /admin', () => {
  const app = resolve(process.cwd(), 'src/app/[locale]');
  const cases = [
    ['candidate', 'CandidatePanelError', 'CandidateNotFound'],
    ['admin', 'AdminPanelError', 'AdminNotFound'],
  ] as const;

  it.each(cases)('%s: error.tsx (klient) i not-found.tsx eksportują granice panelu', (segment, errorName, notFoundName) => {
    const errorFile = resolve(app, segment, 'error.tsx');
    const notFoundFile = resolve(app, segment, 'not-found.tsx');
    expect(existsSync(errorFile)).toBe(true);
    expect(existsSync(notFoundFile)).toBe(true);
    const source = readFileSync(errorFile, 'utf8').trimStart();
    expect(source.startsWith('"use client"') || source.startsWith("'use client'")).toBe(true);
    expect(source).toContain(`${errorName} as default`);
    expect(readFileSync(notFoundFile, 'utf8')).toContain(`${notFoundName} as default`);
  });

  it('guard roli admina nadal rzuca notFound() Z LAYOUTU (nie-admin dostaje ogólną 404)', () => {
    // `notFound()` rzucone przez layout segmentu łapie granica NADRZĘDNA (`[locale]/not-found.tsx`),
    // więc panelowa 404 nie jest widoczna dla nie-admina. Zamiana guardu na redirect albo
    // przeniesienie go do strony zmieniłoby tę semantykę — test pilnuje obecnego kształtu.
    const layout = readFileSync(resolve(app, 'admin', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/if \(identity\.role !== 'admin'\) \{\s*notFound\(\);/);
    expect(existsSync(resolve(app, 'not-found.tsx'))).toBe(true);
  });
});
