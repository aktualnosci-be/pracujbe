import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { DeleteJobDraftButton } from '@/components/employer/DeleteJobDraftButton';

const { deleteJobDraft, refresh } = vi.hoisted(() => ({ deleteJobDraft: vi.fn(), refresh: vi.fn() }));

vi.mock('@/lib/actions/jobs', () => ({ deleteJobDraft }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('DeleteJobDraftButton (#1099 EMP-04)', () => {
  it('usuwa dopiero po potwierdzeniu; anulowanie nic nie woła', async () => {
    deleteJobDraft.mockResolvedValue({ ok: true });
    render(<DeleteJobDraftButton jobId="job-1" title="Magazynier" />);

    fireEvent.click(screen.getByRole('button', { name: 'deleteJobDraftLabel:Magazynier' }));
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'deleteJobDraftCancel' }));
    expect(deleteJobDraft).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'deleteJobDraftLabel:Magazynier' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deleteJobDraftConfirm' }));
    await waitFor(() => expect(deleteJobDraft).toHaveBeenCalledWith('job-1'));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it('błąd: komunikat, bez odświeżenia listy (szkic zostaje)', async () => {
    deleteJobDraft.mockResolvedValue({ ok: false, error: 'PERMISSION_DENIED' });
    render(<DeleteJobDraftButton jobId="job-1" title="" />);

    fireEvent.click(screen.getByRole('button', { name: /deleteJobDraftLabel/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'deleteJobDraftConfirm' }));
    await waitFor(() => expect(deleteJobDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(refresh).not.toHaveBeenCalled();
  });
});
