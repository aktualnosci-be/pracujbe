import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplicationStatusMenu } from '@/components/employer/ApplicationStatusMenu';

const { refresh, transitionApplication } = vi.hoisted(() => ({
  refresh: vi.fn(),
  transitionApplication: vi.fn(),
}));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/applications', () => ({ transitionApplication }));
// Tłumacz testowy: klucz + parametry (widać, że dostępna nazwa niesie kandydata/ofertę/status).
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, params?: Record<string, string>) =>
    params ? `${key}|${Object.values(params).join('|')}` : key,
}));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function renderMenu(status: string) {
  render(
    <ApplicationStatusMenu
      applicationId="demo-application"
      status={status}
      candidateName="Piotr Nowak"
      jobTitle="Operator wózka"
    />,
  );
}

const TRIGGER = /^statusMenuTrigger\|Piotr Nowak\|Operator wózka\|/;

describe('ApplicationStatusMenu', () => {
  it('po wyborze sfokusowanej opcji zamyka panel i przywraca fokus na aktywny trigger', async () => {
    transitionApplication.mockResolvedValue({ ok: true });
    renderMenu('viewed');

    const trigger = screen.getByRole('button', { name: TRIGGER });
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

  it('trigger ma nazwę z kandydatem, ofertą i bieżącym statusem oraz aria-haspopup (#333)', () => {
    renderMenu('submitted');
    const trigger = screen.getByRole('button', {
      name: 'statusMenuTrigger|Piotr Nowak|Operator wózka|submitted',
    });
    expect(trigger).toHaveAttribute('aria-haspopup', 'true');
    fireEvent.click(trigger);
    expect(screen.getByRole('list', { name: 'statusMenuOptions|Piotr Nowak|Operator wózka|submitted' })).toBeInTheDocument();
  });

  it('pokazuje tylko przejścia dozwolone w macierzy DB (#306)', () => {
    renderMenu('submitted');
    fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
    const options = screen.getAllByRole('button').filter((b) => !TRIGGER.test(b.getAttribute('aria-label') ?? ''));
    expect(options.map((b) => b.textContent)).toEqual(['viewed', 'shortlisted', 'interview', 'rejected']);
    expect(screen.queryByRole('button', { name: 'hired' })).not.toBeInTheDocument();
  });

  it.each(['hired', 'rejected', 'withdrawn'])('stan końcowy %s: brak menu, informacja „Status końcowy"', (status) => {
    renderMenu(status);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByText('statusFinal')).toBeInTheDocument();
  });

  it('odrzucenie wymaga potwierdzenia; anulowanie nie woła akcji', async () => {
    transitionApplication.mockResolvedValue({ ok: true });
    renderMenu('interview');
    fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
    fireEvent.click(screen.getByRole('button', { name: 'rejected' }));
    expect(transitionApplication).not.toHaveBeenCalled();
    expect(screen.getByText('statusConfirmQuestion|rejected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'cancel' }));
    expect(transitionApplication).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'rejected' }));
    fireEvent.click(screen.getByRole('button', { name: 'statusConfirmAction' }));
    await waitFor(() => expect(transitionApplication).toHaveBeenCalledWith('demo-application', 'rejected'));
  });

  it('anulowanie potwierdzenia przywraca fokus na status, który je uruchomił (#800)', async () => {
    renderMenu('interview');
    fireEvent.click(screen.getByRole('button', { name: TRIGGER }));

    const rejectedOption = screen.getByRole('button', { name: 'rejected' });
    rejectedOption.focus();
    fireEvent.click(rejectedOption);

    const cancelButton = screen.getByRole('button', { name: 'cancel' });
    cancelButton.focus();
    fireEvent.click(cancelButton);

    // Bez naprawy #800 fokus po odmontowaniu „Anuluj” wraca na <body> (jsdom),
    // więc ta asercja jest czerwona na kodzie sprzed poprawki.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'rejected' })).toHaveFocus(),
    );
    expect(transitionApplication).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: Escape w kroku potwierdzenia zamyka całe menu i wraca fokusem na trigger, nie na opcję', () => {
    renderMenu('interview');
    const trigger = screen.getByRole('button', { name: TRIGGER });
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('button', { name: 'rejected' }));

    fireEvent.keyDown(screen.getByRole('button', { name: 'statusConfirmAction' }), { key: 'Escape' });

    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'cancel' })).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('błąd niedozwolonego przejścia pokazuje osobny komunikat, nie „sprawdź dane"', async () => {
    transitionApplication.mockResolvedValue({ ok: false, error: 'INVALID_TRANSITION' });
    renderMenu('viewed');
    fireEvent.click(screen.getByRole('button', { name: TRIGGER }));
    fireEvent.click(screen.getByRole('button', { name: 'interview' }));
    expect(await screen.findByText('errors.invalidTransition')).toBeInTheDocument();
  });
});
