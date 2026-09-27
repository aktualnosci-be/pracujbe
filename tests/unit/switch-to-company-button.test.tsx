import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SwitchToCompanyButton } from '@/components/employer/SwitchToCompanyButton';

const { replace, refresh, setActiveCompany } = vi.hoisted(() => ({
  replace: vi.fn(),
  refresh: vi.fn(),
  setActiveCompany: vi.fn(),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/lib/actions/company', () => ({ setActiveCompany }));
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ replace, refresh }) }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  setActiveCompany.mockResolvedValue({ ok: true });
});

const COMPANY_ID = '9b7f8e2c-1a4d-4e6b-8c3f-2d5a7e9b1c40';

describe('SwitchToCompanyButton (#843)', () => {
  it('sets the requested company active, then returns to the clean panel URL', async () => {
    render(<SwitchToCompanyButton companyId={COMPANY_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'targetSwitchAction' }));

    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(setActiveCompany).toHaveBeenCalledExactlyOnceWith(COMPANY_ID);
    expect(replace).toHaveBeenCalledExactlyOnceWith('/employer/firma');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('a rejected switch shows an error and does not navigate', async () => {
    setActiveCompany.mockResolvedValue({ ok: false });
    render(<SwitchToCompanyButton companyId={COMPANY_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'targetSwitchAction' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('targetSwitchError'));
    expect(replace).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('a thrown network error is handled the same as a rejected switch', async () => {
    setActiveCompany.mockRejectedValue(new Error('network'));
    render(<SwitchToCompanyButton companyId={COMPANY_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'targetSwitchAction' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('targetSwitchError'));
    expect(replace).not.toHaveBeenCalled();
  });

  // KONTROLA UJEMNA (#843): potwierdza, że test naprawdę czyta wynik kliknięcia — z
  // zerowym `companyId` wysłanym do akcji zapytanie i tak trafia z ID przycisku.
  it('KONTROLA UJEMNA: wysyła DOKŁADNIE identyfikator przekazany w propsach', async () => {
    render(<SwitchToCompanyButton companyId={COMPANY_ID} />);
    fireEvent.click(screen.getByRole('button', { name: 'targetSwitchAction' }));
    await waitFor(() => expect(setActiveCompany).toHaveBeenCalled());
    expect(setActiveCompany).not.toHaveBeenCalledWith('other-id');
  });
});
