import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AdminFeedbackProvider } from '@/components/admin/AdminFeedback';
import { CompanyStatusActions } from '@/components/admin/CompanyStatusActions';
import { ADMIN_PAGE_HEADING_FOCUS, companyFocusKey } from '@/lib/admin/focus';
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

/** Strona z nagłówkiem i (opcjonalnie) nagłówkiem wiersza — jak `admin/firmy/page.tsx`. */
function Page({ children, withRow = true }: { children: ReactNode; withRow?: boolean }) {
  return (
    <AdminFeedbackProvider>
      <h1 tabIndex={-1} data-admin-focus={ADMIN_PAGE_HEADING_FOCUS}>
        Firmy
      </h1>
      {withRow ? (
        <h2 tabIndex={-1} data-admin-focus={companyFocusKey(company.id)}>
          {company.name}
        </h2>
      ) : null}
      {children}
    </AdminFeedbackProvider>
  );
}

// jsdom nie liczy układu — `getClientRects()` jest puste; element widoczny = podpięty do DOM.
Object.defineProperty(HTMLElement.prototype, 'getClientRects', {
  configurable: true,
  value(this: HTMLElement) {
    return this.isConnected ? [{}] : [];
  },
});

/** Uzasadnienie wymagane przy zawieszeniu/odrzuceniu (#310). */
function fillReason(value = 'Zgłoszenia oszustwa') {
  fireEvent.change(screen.getByRole('textbox', { name: 'reasonLabel' }), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('CompanyStatusActions — potwierdzenie zmiany statusu (#310)', () => {
  it('kliknięcie akcji otwiera dialog z danymi firmy i NIE zmienia statusu', () => {
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="3 lut 2025" />
      </Page>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('BE0987654321');
    expect(dialog).toHaveTextContent('0987.654.321');
    expect(dialog).toHaveTextContent('info@example.com');
    expect(dialog).toHaveTextContent('Gent');
    expect(dialog).toHaveTextContent('3 lut 2025');
    // Zawieszenie wymaga uzasadnienia — fokus startuje na polu (#310).
    expect(screen.getByRole('textbox', { name: 'reasonLabel' })).toHaveFocus();
    expect(dialog).toHaveTextContent('ownerNotifiedNote');
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });

  it('Anuluj/Escape zamyka dialog bez zapisu i oddaje fokus przyciskowi akcji', async () => {
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );
    const trigger = screen.getByRole('button', { name: 'actionSuspend' });

    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    await waitFor(() => expect(trigger).toHaveFocus());
    expect(setCompanyStatus).not.toHaveBeenCalled();
  });

  it('dopiero potwierdzenie woła akcję z docelowym i widzianym statusem', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason('  Zgłoszenia oszustwa  ');
    const dialogButtons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(dialogButtons[dialogButtons.length - 1]!);

    await waitFor(() =>
      expect(setCompanyStatus).toHaveBeenCalledWith(
        'company-1',
        'suspended',
        'verified',
        '  Zgłoszenia oszustwa  ',
      ),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('CompanyStatusActions — fokus po potwierdzeniu (#415, WCAG 2.4.3)', () => {
  it('po sukcesie fokus na nagłówku wiersza firmy, toast poza wierszem', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason();
    const buttons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(screen.getByRole('heading', { name: company.name })).toHaveFocus());
    expect(document.activeElement).not.toBe(document.body);
    expect(screen.getByRole('status')).toHaveTextContent('statusChanged');
  });

  it('wiersz zniknął z listy (np. filtr „Do weryfikacji”) → fokus na nagłówku strony', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    const { rerender } = render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'pending' }} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionVerify' }));
    const buttons = screen.getAllByRole('button', { name: 'actionVerify' });
    // Odświeżenie listy usuwa wiersz (firma opuszcza filtr) zanim zakończy się przejście.
    refresh.mockImplementation(() => rerender(<Page withRow={false}>{null}</Page>));
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(screen.getByRole('heading', { name: 'Firmy' })).toHaveFocus());
    // Toast przetrwał odmontowanie wiersza (renderowany przez provider).
    expect(screen.getByRole('status')).toHaveTextContent('statusChanged');
  });

  it('kontrola ujemna: błąd zapisu zostawia dialog otwarty z komunikatem i bez odświeżenia', async () => {
    setCompanyStatus.mockResolvedValue({ ok: false, error: 'PERMISSION_DENIED' });
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason();
    const buttons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('errors.permissionDenied'),
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });

  it('błąd ogólny (INTERNAL) po zapisie: Shift+Tab z fokusem na kontenerze zostaje w dialogu (#837)', async () => {
    let reject!: (reason: unknown) => void;
    setCompanyStatus.mockImplementation(
      () =>
        new Promise((_resolve, rej) => {
          reject = rej;
        }),
    );
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason();
    const buttons = screen.getAllByRole('button', { name: 'actionSuspend' });
    const confirmButton = buttons[buttons.length - 1]!;
    // jsdom nie przenosi fokusu na klik (w przeciwieństwie do przeglądarki) — symulujemy to,
    // żeby odtworzyć rzeczywisty stan przed zapisem (klik myszą skupia przycisk).
    confirmButton.focus();
    fireEvent.click(confirmButton);

    // W trakcie zapisu fokus jest na kontenerze dialogu (#415).
    await waitFor(() => expect(screen.getByRole('alertdialog')).toHaveFocus());

    reject(new Error('boom'));
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('errors.internal'),
    );

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toBeInTheDocument();
    // Fokus wraca z kontenera na kontrolkę sprzed zapisu — nie zostaje na tle #837.
    await waitFor(() => expect(confirmButton).toHaveFocus());

    // Kontrola ujemna: zanim fokus zdąży wrócić z kontenera, Shift+Tab z kontenera nie może
    // wypuścić nawigacji na tło — musi trafić na ostatnią kontrolkę dialogu.
    dialog.focus();
    expect(dialog).toHaveFocus();
    const shiftTab = fireEvent.keyDown(dialog, {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    expect(shiftTab).toBe(false); // preventDefault() wołane → domyślna nawigacja zablokowana
    expect(confirmButton).toHaveFocus();

    // Zwykły Tab z pierwszej kontrolki (pole uzasadnienia) zapętla na ostatnią, nie na tło.
    const reasonField = screen.getByRole('textbox', { name: 'reasonLabel' });
    reasonField.focus();
    fireEvent.keyDown(reasonField, { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true });
    expect(confirmButton).toHaveFocus();
  });

  it('nieaktualny widok (STALE_STATE) → dialog zamknięty, odświeżenie, komunikat', async () => {
    setCompanyStatus.mockResolvedValue({ ok: false, error: 'STALE_STATE' });
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason();
    const buttons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('errors.staleState'));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(refresh).toHaveBeenCalledOnce();
  });
});

describe('CompanyStatusActions — uzasadnienie decyzji (#310)', () => {
  it('kontrola ujemna: odrzucenie bez uzasadnienia nie woła akcji, błąd przy polu z fokusem', () => {
    render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'pending' }} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionRejectCompany' }));
    fillReason('   ');
    const buttons = screen.getAllByRole('button', { name: 'actionRejectCompany' });
    fireEvent.click(buttons[buttons.length - 1]!);

    const field = screen.getByRole('textbox', { name: 'reasonLabel' });
    expect(setCompanyStatus).not.toHaveBeenCalled();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveFocus();
    expect(field.getAttribute('aria-describedby')).toContain(
      screen.getByText('reasonRequired').id,
    );
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
  });

  it('odrzucenie z uzasadnieniem woła akcję z powodem', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'pending' }} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionRejectCompany' }));
    fillReason('VAT nie zgadza się z KBO');
    const buttons = screen.getAllByRole('button', { name: 'actionRejectCompany' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() =>
      expect(setCompanyStatus).toHaveBeenCalledWith(
        'company-1',
        'rejected',
        'pending',
        'VAT nie zgadza się z KBO',
      ),
    );
  });

  it('weryfikacja nie pokazuje pola uzasadnienia i wysyła null', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'pending' }} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionVerify' }));
    expect(screen.queryByRole('textbox', { name: 'reasonLabel' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'confirmCancel' })).toHaveFocus();
    const buttons = screen.getAllByRole('button', { name: 'actionVerify' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() =>
      expect(setCompanyStatus).toHaveBeenCalledWith('company-1', 'verified', 'pending', null),
    );
  });

  it('błąd pola z serwera (REASON_REQUIRED) zostawia dialog z komunikatem przy polu', async () => {
    setCompanyStatus.mockResolvedValue({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'reason',
      reason: 'required',
    });
    render(
      <Page>
        <CompanyStatusActions company={company} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason();
    const buttons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() => expect(screen.getByText('reasonRequired')).toBeInTheDocument());
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(refresh).not.toHaveBeenCalled();
  });
  it('firma jeszcze niezweryfikowana (pending) ma pilną blokadę z uzasadnieniem (#1107)', async () => {
    setCompanyStatus.mockResolvedValue({ ok: true });
    render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'pending' }} createdLabel="—" />
      </Page>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'actionSuspend' }));
    fillReason('Pilna blokada: podejrzenie podszycia.');
    const buttons = screen.getAllByRole('button', { name: 'actionSuspend' });
    fireEvent.click(buttons[buttons.length - 1]!);

    await waitFor(() =>
      expect(setCompanyStatus).toHaveBeenCalledWith(
        'company-1',
        'suspended',
        'pending',
        'Pilna blokada: podejrzenie podszycia.',
      ),
    );
  });

  it('kontrola ujemna: odrzucona firma nie ma zawieszenia, zawieszona ma odrzucenie', () => {
    const { unmount } = render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'rejected' }} createdLabel="—" />
      </Page>,
    );
    expect(screen.queryByRole('button', { name: 'actionSuspend' })).toBeNull();
    unmount();
    render(
      <Page>
        <CompanyStatusActions company={{ ...company, status: 'suspended' }} createdLabel="—" />
      </Page>,
    );
    expect(screen.getByRole('button', { name: 'actionRejectCompany' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'actionReactivate' })).toBeInTheDocument();
  });
});
