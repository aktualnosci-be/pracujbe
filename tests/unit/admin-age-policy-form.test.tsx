import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminFeedbackProvider } from '@/components/admin/AdminFeedback';
import { AgePolicyForm } from '@/components/admin/AgePolicyForm';
import { ADMIN_PAGE_HEADING_FOCUS } from '@/lib/admin/focus';

/**
 * Formularz progu wieku (#639, #1102): administrator nie ustala statusu „zatwierdzone przez
 * właściciela” (brak pola, akcja dostaje tylko próg, uzasadnienie i znacznik wersji), a dialog
 * pokazuje, że zapis będzie wartością roboczą.
 */

const { refresh, setCandidateMinAge } = vi.hoisted(() => ({ refresh: vi.fn(), setCandidateMinAge: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/admin-age-policy', () => ({ setCandidateMinAge }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value(this: HTMLElement) {
    return this.isConnected ? [{}] : [];
  },
});

const VERSION = '2026-09-25 10:00:00.123456+00';

function renderForm() {
  return render(
    <AdminFeedbackProvider>
      <h1 tabIndex={-1} data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}>
        Ustawienia
      </h1>
      <AgePolicyForm minAge={16} updatedAt={VERSION} />
    </AdminFeedbackProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AgePolicyForm', () => {
  it('bez pola „zatwierdzone przez właściciela” — jedyne pola wyboru to progi', () => {
    renderForm();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByText('agePolicyConfirmedHint')).toBeTruthy();
  });

  it('zapis: dialog pokazuje wartość roboczą, akcja dostaje próg, uzasadnienie i znacznik wersji', async () => {
    setCandidateMinAge.mockResolvedValue({ ok: true, hiddenProfiles: 0 });
    renderForm();
    fireEvent.click(screen.getByRole('radio', { name: 'agePolicyOption18' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'agePolicyReasonLabel' }), {
      target: { value: 'Wariant tylko dorośli' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'agePolicySubmit' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('agePolicyAfterSaveLabel');
    expect(dialog.textContent).toContain('agePolicyConfirmedNo');
    const confirm = Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'agePolicySubmit');
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm!);
    await waitFor(() => expect(setCandidateMinAge).toHaveBeenCalledTimes(1));
    expect(setCandidateMinAge).toHaveBeenCalledWith(18, 'Wariant tylko dorośli', VERSION);
  });

  it('STALE_STATE z bazy → komunikat o zmianie innego administratora i odświeżenie strony', async () => {
    setCandidateMinAge.mockResolvedValue({ ok: false, error: 'STALE_STATE' });
    renderForm();
    fireEvent.change(screen.getByRole('textbox', { name: 'agePolicyReasonLabel' }), { target: { value: 'Powód' } });
    fireEvent.click(screen.getByRole('button', { name: 'agePolicySubmit' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === 'agePolicySubmit')!);
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('agePolicyStale')).toBeTruthy();
  });
});
