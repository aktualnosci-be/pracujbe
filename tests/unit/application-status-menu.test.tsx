import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';

const { refresh, transitionApplication } = vi.hoisted(() => ({
  refresh: vi.fn(),
  transitionApplication: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/applications', () => ({ transitionApplication }));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('ApplicationStatusMenu', () => {
  it('po wyborze sfokusowanej opcji zamyka panel i przywraca fokus na aktywny trigger', async () => {
    transitionApplication.mockResolvedValue({ ok: true });
    render(<ApplicationStatusMenu applicationId="demo-application" status="viewed" />);

    const trigger = screen.getByRole('button', { name: 'colStatusEmp' });
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(trigger);

    const option = screen.getByRole('button', { name: 'interview' });
    option.focus();
    expect(option).toHaveFocus();
    fireEvent.keyDown(option, { key: 'Enter' });
    fireEvent.click(option);

    await waitFor(() => expect(screen.queryByRole('list')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toBeEnabled());
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(transitionApplication).toHaveBeenCalledWith('demo-application', 'interview');
    expect(refresh).toHaveBeenCalledOnce();
  });
});
