import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ReportCaseLookup } from '@/components/public/ReportCaseLookup';
import type { ReportCaseView } from '@/lib/content-reports/case';

/**
 * #884 — formularz odwołania na `/zglos-tresc/sprawa` musi zawsze celować w sprawę widoczną
 * na ekranie, także gdy użytkownik zmieni numer sprawy/kod dostępu w polach PODCZAS oczekiwania
 * na odpowiedź poprzedniego sprawdzenia (`getValues()` czytał aktualną treść pól, nie snapshot
 * odczytu, który faktycznie się powiódł).
 */

const { lookupReportCase } = vi.hoisted(() => ({ lookupReportCase: vi.fn() }));

vi.mock('@/lib/actions/content-reports', () => ({ lookupReportCase }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'pl',
}));
vi.mock('@/components/moderation/AppealForm', () => ({
  AppealForm: ({ target }: { target: { kind: string; caseNumber: string; accessCode: string } }) => (
    <div data-testid="appeal-form" data-case-number={target.caseNumber} data-access-code={target.accessCode} />
  ),
}));

function reportFor(caseNumber: string): ReportCaseView {
  return {
    caseNumber,
    status: 'resolved',
    targetType: 'job',
    category: 'fraud',
    createdAt: '2026-01-01T00:00:00.000Z',
    dueAt: null,
    outcome: 'no_action',
    appealState: 'OK',
    appealDeadline: '2026-07-01T00:00:00.000Z',
    appeal: null,
    restoration: null,
    events: [{ type: 'submitted', toStatus: null, at: '2026-01-01T00:00:00.000Z' }],
  };
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Zgodne z CASE_NUMBER_RE / ACCESS_CODE_RE (src/lib/validation/content-report.ts).
const CASE_A = 'DSA-AAAA-AAAA-AAAA-AAAA';
const CODE_A = 'AAAAAAAAAAAAAAAAAAAAAAAA';
const CASE_B = 'DSA-BBBB-BBBB-BBBB-BBBB';
const CODE_B = 'BBBBBBBBBBBBBBBBBBBBBBBB';

function fillAndSubmit(caseNumber: string, accessCode: string) {
  fireEvent.change(screen.getByLabelText('caseNumberLabel'), { target: { value: caseNumber } });
  fireEvent.change(screen.getByLabelText('accessCodeLabel'), { target: { value: accessCode } });
  fireEvent.click(screen.getByRole('button', { name: 'lookupSubmit' }));
}

describe('ReportCaseLookup — cel formularza odwołania', () => {
  it('kontrola: bez edycji pól odwołanie celuje w sprawę A', async () => {
    lookupReportCase.mockResolvedValueOnce({ ok: true, report: reportFor(CASE_A) });
    render(<ReportCaseLookup />);

    fillAndSubmit(CASE_A, CODE_A);
    await waitFor(() => expect(screen.getByTestId('appeal-form')).toBeInTheDocument());

    const form = screen.getByTestId('appeal-form');
    expect(form.dataset.caseNumber).toBe(CASE_A);
    expect(form.dataset.accessCode).toBe(CODE_A);
  });

  it('edycja pól na sprawę B podczas oczekiwania na wynik A nie zmienia celu odwołania', async () => {
    let resolveLookup: (value: { ok: true; report: ReportCaseView }) => void;
    lookupReportCase.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveLookup = resolve;
        }),
    );
    render(<ReportCaseLookup />);

    fillAndSubmit(CASE_A, CODE_A);
    await waitFor(() => expect(lookupReportCase).toHaveBeenCalledTimes(1));

    // Oczekiwanie na odpowiedź A: użytkownik wpisuje dane sprawy B, ale NIE wysyła drugiego
    // odczytu (reprodukcja kroków 1–4 ze zgłoszenia #884).
    fireEvent.change(screen.getByLabelText('caseNumberLabel'), { target: { value: CASE_B } });
    fireEvent.change(screen.getByLabelText('accessCodeLabel'), { target: { value: CODE_B } });

    resolveLookup!({ ok: true, report: reportFor(CASE_A) });

    await waitFor(() => expect(screen.getByTestId('appeal-form')).toBeInTheDocument());

    const form = screen.getByTestId('appeal-form');
    // Wynik na ekranie to sprawa A — formularz odwołania MUSI celować w A, nigdy w B.
    expect(form.dataset.caseNumber).toBe(CASE_A);
    expect(form.dataset.accessCode).toBe(CODE_A);
  });

  it('pola numeru sprawy i kodu dostępu są zablokowane podczas oczekiwania na odpowiedź', async () => {
    lookupReportCase.mockImplementationOnce(() => new Promise(() => undefined));
    render(<ReportCaseLookup />);

    fillAndSubmit(CASE_A, CODE_A);

    await waitFor(() => expect(screen.getByLabelText('caseNumberLabel')).toBeDisabled());
    expect(screen.getByLabelText('accessCodeLabel')).toBeDisabled();
  });
});
