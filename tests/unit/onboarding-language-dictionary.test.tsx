import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWizard } from '@/components/candidate/OnboardingWizard';

/**
 * I18N-02 / CF-02 (0920): krok 5 onboardingu wybiera język ze słownika (kod ISO), a nie
 * wpisuje wolny tekst. Stary wpis rozpoznany z nazwy pokazuje nazwę słownikową i nie daje
 * duplikatu; wpis spoza słownika zostaje etykietą (bez utraty danych).
 */

const { saveOnboardingStep, push } = vi.hoisted(() => ({ saveOnboardingStep: vi.fn(), push: vi.fn() }));

vi.mock('@/lib/actions/onboarding', () => ({ saveOnboardingStep }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
// Translator zwraca klucz — `languageNames.nl` renderuje się jako „lang:nl”.
vi.mock('next-intl', () => ({
  useTranslations: (ns?: string) => {
    const t = (key: string, params?: Record<string, unknown>) =>
      ns === 'languageNames' ? `lang:${key}` : params ? `${key}:${JSON.stringify(params)}` : key;
    return Object.assign(t, { rich: (key: string) => key });
  },
}));

// Radix Checkbox (zgoda w kroku 6, montowana w kreatorze) mierzy rozmiar przez ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const INITIAL = {
  city: 'Antwerpen',
  radiusKm: 25,
  languages: [
    { language: 'niderlandzki', level: 'basic' as const },
    { language: 'Klingon', level: 'fluent' as const },
  ],
};

function lastStep5Languages(): unknown {
  const call = saveOnboardingStep.mock.calls.filter((c) => c[0] === 5).at(-1);
  return (call?.[1] as { languages?: unknown } | undefined)?.languages;
}

function choose(code: string): void {
  fireEvent.click(screen.getByRole('combobox', { name: 'languagesLabel' }));
  fireEvent.click(screen.getByRole('option', { name: `lang:${code}` }));
  fireEvent.click(screen.getByRole('button', { name: 'addLanguage' }));
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  saveOnboardingStep.mockResolvedValue({ ok: true, demo: false });
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('OnboardingWizard krok 5: języki ze słownika (0920)', () => {
  it('lista zamiast pola tekstowego; stary wpis rozpoznany → nazwa słownikowa, spoza słownika → etykieta', () => {
    render(<OnboardingWizard initialValues={INITIAL} initialStep={5} />);
    expect(screen.queryByRole('textbox', { name: 'languagesLabel' })).toBeNull();
    expect(screen.getByRole('combobox', { name: 'languagesLabel' })).toBeInTheDocument();
    expect(screen.getByText(/^lang:nl ·/)).toBeInTheDocument();
    expect(screen.getByText(/^Klingon ·/)).toBeInTheDocument();
  });

  it('wybrany język zapisuje się kodem, ten sam język drugi raz nie dubluje wpisu', async () => {
    render(<OnboardingWizard initialValues={INITIAL} initialStep={5} />);
    choose('de');
    choose('nl');
    fireEvent.click(screen.getByRole('button', { name: /^next/ }));
    await waitFor(() => expect(saveOnboardingStep).toHaveBeenCalled());
    expect(lastStep5Languages()).toEqual([
      { language: 'niderlandzki', level: 'basic' },
      { language: 'Klingon', level: 'fluent' },
      { language: 'de', level: 'basic' },
    ]);
  });

  it('kontrola ujemna: „Dodaj” bez wyboru z listy pokazuje błąd i niczego nie dodaje', async () => {
    render(<OnboardingWizard initialValues={{ city: 'Gent', radiusKm: 10 }} initialStep={5} />);
    fireEvent.click(screen.getByRole('button', { name: 'addLanguage' }));
    expect(screen.getByText('candidate.error.languageInvalid')).toBeInTheDocument();
  });
});
