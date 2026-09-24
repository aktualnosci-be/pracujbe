import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminFeedbackProvider } from '@/components/admin/AdminFeedback';
import { ReportActions } from '@/components/admin/ReportActions';
import { ADMIN_PAGE_HEADING_FOCUS, reportFocusKey } from '@/lib/admin/focus';

const { refresh, resolveReport } = vi.hoisted(() => ({
  refresh: vi.fn(),
  resolveReport: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/admin', () => ({ resolveReport }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value(this: HTMLElement) {
    return this.isConnected ? [{}] : [];
  },
});

function renderActions(status = 'open') {
  return render(
    <AdminFeedbackProvider>
      <h1 tabIndex={-1} data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}>
        Zgłoszenia
      </h1>
      <h2 tabIndex={-1} data-admin-focus={reportFocusKey('r1')}>
        Spam
      </h2>
      <ReportActions
        reportId="r1"
        status={status}
        targetTypeLabel="Oferta"
        targetLabel="Magazynier – Gent"
        reasonLabel="Spam"
      />
    </AdminFeedbackProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ReportActions — potwierdzenie rozstrzygnięcia (#422)', () => {
  it.each(['actionResolve', 'actionDismissReport'])(
    '%s otwiera dialog z celem zgłoszenia i nie zapisuje od razu',
    (label) => {
      renderActions();
      fireEvent.click(screen.getByRole('button', { name: label }));
      const dialog = screen.getByRole('alertdialog');
      expect(dialog).toHaveTextContent('Magazynier – Gent');
      expect(dialog).toHaveTextContent('Oferta');
      expect(screen.getByRole('button', { name: 'confirmCancel' })).toHaveFocus();
      expect(resolveReport).not.toHaveBeenCalled();
    },
  );

  it('Escape zamyka bez zapisu i oddaje fokus przyciskowi', async () => {
    renderActions();
    const trigger = screen.getByRole('button', { name: 'actionDismissReport' });
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(resolveReport).not.toHaveBeenCalled();
  });

  it('potwierdzenie → zapis z widzianym statusem, fokus na karcie (nie body)', async () => {
    resolveReport.mockResolvedValue({ ok: true });
    renderActions('reviewing');
    fireEvent.click(screen.getByRole('button', { name: 'actionResolve' }));
    const buttons = screen.getAllByRole('button', { name: 'actionResolve' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith('r1', 'resolved', 'reviewing'));
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Spam' })).toHaveFocus());
    expect(screen.getByRole('status')).toHaveTextContent('reportResolved');
  });

  it('„Weź do analizy” (krok odwracalny) zapisuje bez dialogu, w neutralnym tonie', async () => {
    resolveReport.mockResolvedValue({ ok: true });
    renderActions();
    const review = screen.getByRole('button', { name: 'actionReview' });
    expect(review.className).not.toMatch(/accent|error/);
    fireEvent.click(review);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(resolveReport).toHaveBeenCalledWith('r1', 'reviewing', 'open'));
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
  });
});
