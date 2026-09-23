import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';
import type { AdminCompanyRow } from '@/lib/data/admin';

const { refresh, setCompanyStatus } = vi.hoisted(() => ({
  refresh: vi.fn(),
  setCompanyStatus: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/admin', () => ({ setCompanyStatus }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

const company: AdminCompanyRow = {
  id: 'company-1',
  name: 'Bouwbedrijf De Vos',
  status: 'verified',
  createdAt: '2025-02-03T11:30:00.000Z',
  vatNumber: 'BE0987654321',
  registrationNumber: '0987.654.321',
  email: 'info@example.com',
  city: 'Gent',
};

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('CompanyStatusActions — potwierdzenie zmiany statusu (#310)', () => {
  it('kliknięcie akcji otwiera dialog z danymi firmy i NIE zmienia statusu', () => {
    render(<CompanyStatusActions company={company} createdLabel="3 lut 2025" />);

    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('BE0987654321');
    expect(dialog).toHaveTextContent('0987.654.321');
    expect(dialog).toHaveTextContent('info@example.com');
    expect(dialog).toHaveTextContent('Gent');
    expect(dialog).toHaveTextContent('3 lut 2025');
    expect(screen.getByRole('button', { name: 'confirmCancel' })).toHaveFocus();
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });

  it('Anuluj/Escape zamyka dialog bez zapisu i oddaje fokus przyciskowi akcji', async () => {
    render(<CompanyStatusActions company={company} createdLabel="—" />);
    const trigger = screen.getByRole('button', { name: 'actionSuspend' });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });

  it('dopiero potwierdzenie woła akcję z docelowym statusem', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    render(<CompanyStatusActions company={company} createdLabel="—" />);

    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    const dialogButtons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]!);

    await waitFor(() => expect(setCompanyStatus).toHaveBeenCalledWith('company-1', 'suspended'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledOnce();
  });
});
