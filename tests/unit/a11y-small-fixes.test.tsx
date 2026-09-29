import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #1095 — drobne poprawki dostępności: nazwa dostępna comboboxa poziomu języka (etykieta pola,
 * nie bieżąca wartość), przycisk zamknięcia szuflady panelu ("Zamknij", nie "Anuluj") i dzwonek
 * powiadomień bez `aria-haspopup` (panel nie jest menu).
 */

const { push, refresh, saveOnboardingStep } = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  saveOnboardingStep: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/onboarding', () => ({ saveOnboardingStep }));
vi.mock('@/lib/actions/notifications', () => ({ markNotificationsRead: vi.fn() }));
vi.mock('@/lib/actions/auth', () => ({ signOut: vi.fn() }));
vi.mock('@/components/brand/Logo', () => ({ Logo: () => null }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push, refresh }),
  Link: ({ children, href, ...rest }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { DashboardShell } from '@/components/dashboard/DashboardShell';
import { OnboardingWizard } from '@/components/candidate/OnboardingWizard';

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const MESSAGES = { pl, nl, fr, en } as const;
type Loc = keyof typeof MESSAGES;
const LOCALES = Object.keys(MESSAGES) as Loc[];

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  saveOnboardingStep.mockResolvedValue({ ok: true, demo: false });
});
afterEach(cleanup);

describe('poziom języka w onboardingu: nazwa dostępna = etykieta pola (#1095)', () => {
  it.each(LOCALES)('%s: combobox poziomu ma stałą nazwę, a wartość zmienia się osobno', (locale) => {
    render(
      <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
        <OnboardingWizard initialValues={{ city: 'Antwerpen', radiusKm: 25, languages: [] }} initialStep={5} />
      </NextIntlClientProvider>,
    );
    const label = MESSAGES[locale].onboarding.languageLevelLabel;
    expect(label).toBeTruthy();
    const level = screen.getByRole('combobox', { name: label });
    // Kontrola ujemna: nazwa NIE jest bieżącą wartością (dawny błąd — czytnik nie ogłaszał, czego dotyczy pole).
    expect(screen.queryByRole('combobox', { name: MESSAGES[locale].onboarding.levelBasic })).toBeNull();
    fireEvent.click(level);
    fireEvent.click(screen.getByRole('option', { name: MESSAGES[locale].onboarding.levelFluent }));
    expect(screen.getByRole('combobox', { name: label })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: label })).toHaveTextContent(MESSAGES[locale].onboarding.levelFluent);
  });
});

function renderShell(locale: Loc) {
  return render(
    <NextIntlClientProvider locale={locale} messages={MESSAGES[locale]}>
      <DashboardShell
        nav={[{ href: '/employer', label: 'Pulpit', icon: 'home' } as never]}
        active="/employer"
        user={{ name: 'Jan', initials: 'J' }}
        notifications={1}
        notifItems={[]}
      >
        <p>content</p>
      </DashboardShell>
    </NextIntlClientProvider>,
  );
}

describe('szuflada i dzwonek panelu (#1095)', () => {
  it.each(LOCALES)('%s: przycisk zamknięcia szuflady nazywa się „Zamknij”, nie „Anuluj”', (locale) => {
    renderShell(locale);
    fireEvent.click(screen.getAllByRole('button', { name: MESSAGES[locale].nav.menu })[0]!);
    const dialog = screen.getByRole('dialog', { name: MESSAGES[locale].nav.menu });
    const close = screen.getByRole('button', { name: MESSAGES[locale].nav.close });
    expect(dialog).toContainElement(close);
    expect(screen.queryByRole('button', { name: MESSAGES[locale].common.cancel })).toBeNull();
  });

  it('dzwonek nie deklaruje menu (aria-haspopup), zachowuje aria-expanded', () => {
    renderShell('pl');
    const bell = screen.getByRole('button', { name: new RegExp(`^${pl.notifications.title}`) });
    expect(bell).not.toHaveAttribute('aria-haspopup');
    expect(bell).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(bell);
    expect(bell).toHaveAttribute('aria-expanded', 'true');
  });
});
