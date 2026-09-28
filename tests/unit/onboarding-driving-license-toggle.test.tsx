import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWizard } from '@/components/candidate/OnboardingWizard';

/**
 * #762 — kreator kroku 4 pokazywał pigułki kategorii prawa jazdy (B/C/C+E), ale zapisywał
 * wyłącznie boolean `hasDrivingLicense`; wybrana kategoria ginęła po przeładowaniu, a matching
 * (`src/lib/matching/score.ts`) i tak liczy tylko boolean. Interfejs sugerował więc utrwalenie
 * danych, których produkt w ogóle nie przechowuje ani nie porównuje z wymaganiami oferty
 * (zgodnie z alternatywą ze zgłoszenia: usunąć pozorną granularność i zostawić jednoznaczne
 * pytanie boolean — tak jak `hasCar`/`requiresDrivingLicense` w kreatorze oferty pracodawcy).
 */

const { saveOnboardingStep, push } = vi.hoisted(() => ({
  saveOnboardingStep: vi.fn(),
  push: vi.fn(),
}));

vi.mock('@/lib/actions/onboarding', () => ({ saveOnboardingStep }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, unknown>) =>
    params ? `${key}:${JSON.stringify(params)}` : key,
}));

const INITIAL = {
  city: 'Antwerpen',
  radiusKm: 25,
};

function lastStep4Save(): { hasDrivingLicense: boolean } | undefined {
  const call = saveOnboardingStep.mock.calls.filter((c) => c[0] === 4).at(-1);
  return call?.[1] as { hasDrivingLicense: boolean } | undefined;
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  saveOnboardingStep.mockResolvedValue({ ok: true, demo: false });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('OnboardingWizard krok 4: pytanie o prawo jazdy jest jednoznacznym boolean (#762)', () => {
  it('nie renderuje już pozornych kategorii B/C/C+E', () => {
    render(<OnboardingWizard initialValues={INITIAL} initialStep={4} />);

    expect(screen.queryByRole('button', { name: 'catB' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'catC' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'catCE' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'noLicense' })).not.toBeInTheDocument();
  });

  it('wybór „Tak” zapisuje hasDrivingLicense=true przy przejściu do kroku 5', async () => {
    render(<OnboardingWizard initialValues={INITIAL} initialStep={4} />);

    const group = screen.getByRole('group', { name: 'drivingLicense' });
    fireEvent.click(within(group).getByRole('button', { name: 'yes' }));
    fireEvent.click(screen.getByRole('button', { name: /^next/ }));

    await waitFor(() => expect(saveOnboardingStep).toHaveBeenCalled());
    expect(lastStep4Save()).toMatchObject({ hasDrivingLicense: true });
  });

  it('kontrola ujemna: bez interakcji krok 4 zapisuje hasDrivingLicense=false (wartość domyślna)', async () => {
    render(<OnboardingWizard initialValues={INITIAL} initialStep={4} />);

    fireEvent.click(screen.getByRole('button', { name: /^next/ }));

    await waitFor(() => expect(saveOnboardingStep).toHaveBeenCalled());
    expect(lastStep4Save()).toMatchObject({ hasDrivingLicense: false });
  });
});
