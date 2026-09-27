import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { OnboardingWizard } from '@/components/candidate/OnboardingWizard';

/**
 * #813 — pola kroku 1 kreatora onboardingu zostają edytowalne w trakcie zapisu, a akcja
 * `saveOnboardingStep` dostaje jednorazowy snapshot z chwili kliknięcia „Zapisz i wyjdź”/„Dalej”.
 * Zmiana wprowadzona, zanim serwer odpowie, nie może zniknąć: kolejny zapis (przed nawigacją)
 * musi nieść nowszą wartość, a stan „Zapisano” nie może pojawić się dla przestarzałego snapshotu.
 * Wzorzec identyczny z naprawą #829 dla `JobWizard` (`job-wizard-save-revision.test.tsx`).
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

type SaveResult = { ok: true; demo?: boolean } | { ok: false; error: string };

const INITIAL = {
  firstName: 'Jan',
  lastName: 'Kowalski',
  phone: '+32 470 11 22 33',
};

/** Pierwszy zapis czeka na ręczne rozwiązanie; kolejne kończą się od razu sukcesem. */
function deferFirstSave(): (value?: SaveResult) => void {
  let resolveSave: (value: SaveResult) => void = () => {};
  saveOnboardingStep.mockImplementationOnce(
    () =>
      new Promise<SaveResult>((resolve) => {
        resolveSave = resolve;
      }),
  );
  return (value = { ok: true, demo: false }) => resolveSave(value);
}

function phoneInput(): HTMLElement {
  return screen.getByLabelText('phone');
}

function savedPhones(): unknown[] {
  return saveOnboardingStep.mock.calls
    .filter((call) => call[0] === 1)
    .map((call) => (call[1] as { phone: string }).phone);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  saveOnboardingStep.mockResolvedValue({ ok: true, demo: false });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('OnboardingWizard: edycja w trakcie zapisu kroku 1 (#813)', () => {
  it('„Zapisz i wyjdź”: telefon zmieniony przed odpowiedzią serwera jest zapisany przed wyjściem', async () => {
    const resolveSave = deferFirstSave();
    render(<OnboardingWizard initialValues={INITIAL} initialStep={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'saveExit' }));
    expect(saveOnboardingStep).toHaveBeenCalledTimes(1);
    fireEvent.change(phoneInput(), { target: { value: '+32 470 99 88 77' } });
    resolveSave();

    await waitFor(() => expect(push).toHaveBeenCalledWith('/candidate'));
    expect(savedPhones()).toEqual(['+32 470 11 22 33', '+32 470 99 88 77']);
    // Ostatni zapis niesie nowszą wartość i kończy się PRZED nawigacją.
    const lastSave = saveOnboardingStep.mock.invocationCallOrder.at(-1) ?? 0;
    expect(lastSave).toBeLessThan(push.mock.invocationCallOrder[0] ?? 0);
  });

  it('„Dalej”: nowsza wartość telefonu zapisana, zanim kreator przejdzie do kroku 2', async () => {
    const resolveSave = deferFirstSave();
    render(<OnboardingWizard initialValues={INITIAL} initialStep={1} />);

    fireEvent.click(screen.getByRole('button', { name: /^next/ }));
    fireEvent.change(phoneInput(), { target: { value: '+32 470 99 88 77' } });
    resolveSave();

    await screen.findByText('step2Title', { selector: 'h2' });
    expect(savedPhones()).toEqual(['+32 470 11 22 33', '+32 470 99 88 77']);
  });

  it('kontrola ujemna: bez zmian w trakcie zapisu — jeden zapis (brak zbędnego ponowienia)', async () => {
    render(<OnboardingWizard initialValues={INITIAL} initialStep={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'saveExit' }));

    await waitFor(() => expect(push).toHaveBeenCalledWith('/candidate'));
    expect(saveOnboardingStep).toHaveBeenCalledTimes(1);
  });

  it('błąd ponownego zapisu nowszej wartości: bez wyjścia, wartość telefonu zostaje w formularzu', async () => {
    const resolveSave = deferFirstSave();
    saveOnboardingStep.mockResolvedValueOnce({ ok: false, error: 'INTERNAL' });
    render(<OnboardingWizard initialValues={INITIAL} initialStep={1} />);

    fireEvent.click(screen.getByRole('button', { name: 'saveExit' }));
    fireEvent.change(phoneInput(), { target: { value: '+32 470 99 88 77' } });
    resolveSave();

    await waitFor(() => expect(saveOnboardingStep).toHaveBeenCalledTimes(1));
    expect(push).not.toHaveBeenCalled();
    expect(phoneInput()).toHaveValue('+32 470 99 88 77');
  });
});
