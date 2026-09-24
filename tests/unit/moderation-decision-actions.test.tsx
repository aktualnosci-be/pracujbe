import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminFeedbackProvider } from '@/components/admin/AdminFeedback';
import { ModerationDecisionActions } from '@/components/admin/ModerationDecisionActions';
import { ADMIN_PAGE_HEADING_FOCUS, reportFocusKey } from '@/lib/admin/focus';

/**
 * #42 — sprawa DSA w panelu admina: bez przycisku „Rozwiąż” (sam status nie rozstrzyga),
 * decyzja z uzasadnieniem w dialogu, błędy przy polach z fokusem, cofnięcie ograniczenia.
 */

const { refresh, decideReport, resolveReport, restoreModeration } = vi.hoisted(() => ({
  refresh: vi.fn(),
  decideReport: vi.fn(),
  resolveReport: vi.fn(),
  restoreModeration: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/admin', () => ({ decideReport, resolveReport, restoreModeration }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value(this: HTMLElement) {
    return this.isConnected ? [{}] : [];
  },
});

const FACTS = 'Oferta wymaga od kandydatów opłaty za rekrutację z góry.';

function renderActions(
  status = 'reviewing',
  decision: { id: string; reference: string; decision: string; restoredAt: string | null } | null = null,
  targetType = 'job',
) {
  return render(
    <AdminFeedbackProvider>
      <h1 tabIndex={-1} data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}>
        Zgłoszenia
      </h1>
      <h2 tabIndex={-1} data-admin-focus={reportFocusKey('r1')}>
        Oszustwo
      </h2>
      <ModerationDecisionActions
        reportId="r1"
        status={status}
        caseNumber="DSA-1A2B-3C4D-5E6F-7A8B"
        targetType={targetType}
        targetTypeLabel="Oferta"
        targetLabel="Magazynier – Gent"
        reasonLabel="Oszustwo"
        decision={decision}
      />
    </AdminFeedbackProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ModerationDecisionActions (#42)', () => {
  it('sprawa DSA nie ma „Rozwiąż” ani „Oddal” — tylko analiza i decyzja', () => {
    renderActions('open');
    expect(screen.getByRole('button', { name: 'actionReview' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actionDecide' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'actionResolve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'actionDismissReport' })).toBeNull();
  });

  it('zgłoszenie firmy nie oferuje wycofania pojedynczej oferty', () => {
    renderActions('reviewing', null, 'company');
    fireEvent.click(screen.getByRole('button', { name: 'actionDecide' }));
    expect(screen.queryByRole('radio', { name: 'decisionJobRemoved' })).toBeNull();
    expect(screen.getByRole('radio', { name: 'decisionCompanySuspended' })).toBeInTheDocument();
  });

  it('ograniczenie bez podstawy → błąd przy polu i fokus, bez zapisu', async () => {
    renderActions();
    fireEvent.click(screen.getByRole('button', { name: 'actionDecide' }));
    fireEvent.click(screen.getByRole('radio', { name: 'decisionJobRemoved' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'decisionFactsLabel' }), { target: { value: FACTS } });
    fireEvent.click(screen.getByRole('button', { name: 'decisionConfirm' }));
    await waitFor(() => expect(screen.getByRole('radio', { name: 'decisionGroundTerms' })).toHaveFocus());
    expect(screen.getByText('decisionErrorRequired')).toBeInTheDocument();
    expect(decideReport).not.toHaveBeenCalled();
  });

  it('pełna decyzja → jedno wywołanie z widzianym statusem, fokus na karcie', async () => {
    decideReport.mockResolvedValue({ ok: true });
    renderActions('reviewing');
    fireEvent.click(screen.getByRole('button', { name: 'actionDecide' }));
    fireEvent.click(screen.getByRole('radio', { name: 'decisionJobRemoved' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'decisionFactsLabel' }), { target: { value: FACTS } });
    fireEvent.click(screen.getByRole('radio', { name: 'decisionGroundLaw' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'decisionGroundReferenceLabel' }), {
      target: { value: 'Art. 7' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'decisionAutomatedLabel' }));
    fireEvent.click(screen.getByRole('button', { name: 'decisionConfirm' }));

    await waitFor(() =>
      expect(decideReport).toHaveBeenCalledWith('r1', 'reviewing', 'job', {
        decision: 'job_removed',
        facts: FACTS,
        groundType: 'law',
        groundReference: 'Art. 7',
        automatedDetection: true,
      }),
    );
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Oszustwo' })).toHaveFocus());
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('błąd pola z bazy wraca przy polu', async () => {
    decideReport.mockResolvedValue({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'facts',
      fieldError: 'tooLong',
    });
    renderActions('open');
    fireEvent.click(screen.getByRole('button', { name: 'actionDecide' }));
    fireEvent.click(screen.getByRole('radio', { name: 'decisionNoAction' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'decisionFactsLabel' }), { target: { value: FACTS } });
    fireEvent.click(screen.getByRole('button', { name: 'decisionConfirm' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'decisionFactsLabel' })).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'decisionFactsLabel' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('ograniczenie w mocy → „Cofnij ograniczenie” z wymaganym powodem', async () => {
    restoreModeration.mockResolvedValue({ ok: true });
    renderActions('resolved', { id: 'd1', reference: 'DEC-1', decision: 'job_removed', restoredAt: null });
    fireEvent.click(screen.getByRole('button', { name: 'actionRestore' }));
    const reason = screen.getByRole('textbox', { name: 'restoreReasonLabel' });
    expect(reason).toHaveFocus();
    fireEvent.change(reason, { target: { value: 'Autor usunął wymóg opłaty z oferty.' } });
    const buttons = screen.getAllByRole('button', { name: 'actionRestore' });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() =>
      expect(restoreModeration).toHaveBeenCalledWith('d1', 'Autor usunął wymóg opłaty z oferty.'),
    );
  });

  it('cofnięte ograniczenie albo brak działań → bez akcji', () => {
    renderActions('resolved', { id: 'd1', reference: 'DEC-1', decision: 'job_removed', restoredAt: '2026-09-24T10:00:00Z' });
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    renderActions('dismissed', { id: 'd2', reference: 'DEC-2', decision: 'no_action', restoredAt: null });
    expect(screen.queryByRole('button')).toBeNull();
  });
});
