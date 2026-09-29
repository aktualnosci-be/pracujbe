import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyAgencyForm } from '@/components/employer/CompanyAgencyForm';
import { CompanyForm } from '@/components/employer/CompanyForm';
import { AppealForm } from '@/components/moderation/AppealForm';
import { SaveSearchButton } from '@/components/public/SaveSearchButton';
import { updateCompany } from '@/lib/actions/company';
import { updateCompanyAgency } from '@/lib/actions/job-trust';
import { saveSearchAction } from '@/lib/actions/saved-searches';
import pl from '@/messages/pl.json';

/**
 * #1238 — po zapisie formularza, który na czas zapisu blokuje przycisk, fokus trafia na
 * komunikat wyniku (sukcesu albo błędu), a nie zostaje na `<body>`.
 * #1243 — „Anuluj” w formularzu odwołania przywraca fokus na przycisk „Odwołaj się”.
 *
 * jsdom nie gubi fokusu przy `disabled`, więc atrapa akcji robi to, co przeglądarka: aktywny
 * element traci fokus (`document.activeElement` = `<body>`) na czas zapisu.
 */

const { refresh, push } = vi.hoisted(() => ({ refresh: vi.fn(), push: vi.fn() }));
vi.mock('@/i18n/navigation', () => ({
  useRouter: () => ({ refresh, push }),
  Link: ({ href, locale: _l, children, ...rest }: { href: string; locale?: string; children: React.ReactNode }) => (
    <a href={typeof href === 'string' ? href : '#'} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock('@/lib/actions/company', () => ({
  updateCompany: vi.fn(),
  createCompany: vi.fn(),
  createAdditionalCompany: vi.fn(),
}));
vi.mock('@/lib/actions/job-trust', () => ({ updateCompanyAgency: vi.fn() }));
vi.mock('@/lib/actions/saved-searches', () => ({ saveSearchAction: vi.fn() }));
vi.mock('@/lib/actions/appeals', () => ({ submitModerationAppeal: vi.fn(), submitReportAppeal: vi.fn() }));

Element.prototype.scrollIntoView ??= function scrollIntoView() {};

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

const wrap = (node: React.ReactNode) => (
  <NextIntlClientProvider locale="pl" messages={pl}>
    {node}
  </NextIntlClientProvider>
);

/**
 * Aktywny element traci fokus na czas zapisu (jak `disabled` w przeglądarce): `activeElement`
 * zwraca `<body>`, dopóki ktoś jawnie nie przeniesie fokusu (jsdom ignoruje `blur()` na
 * wyłączonym elemencie, więc nadpisujemy getter).
 */
function loseFocusDuringSave<T>(result: T): Promise<T> {
  const el = document.activeElement as HTMLElement | null;
  if (el && el !== document.body) {
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => document.body });
    document.addEventListener('focusin', clearFocusOverride, { once: true });
  }
  return Promise.resolve(result);
}

function clearFocusOverride(): void {
  delete (document as unknown as Record<string, unknown>).activeElement;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  document.removeEventListener('focusin', clearFocusOverride);
  clearFocusOverride();
});

describe('fokus po zapisie (#1238)', () => {
  it('dane firmy: fokus na komunikacie sukcesu', async () => {
    vi.mocked(updateCompany).mockImplementation(() => loseFocusDuringSave({ ok: true } as never));
    render(wrap(<CompanyForm mode="edit" companyId={COMPANY_ID} defaultValues={{ name: 'Firma', vatNumber: '' }} />));
    const save = screen.getByRole('button', { name: pl.company.submitSave });
    save.focus();
    fireEvent.click(save);
    const status = await screen.findByRole('status', {}, { timeout: 4000 });
    expect(status).toHaveTextContent(pl.company.savedSuccess);
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('dane firmy: fokus na komunikacie błędu', async () => {
    vi.mocked(updateCompany).mockImplementation(() => loseFocusDuringSave({ ok: false, error: 'INTERNAL' } as never));
    render(wrap(<CompanyForm mode="edit" companyId={COMPANY_ID} defaultValues={{ name: 'Firma', vatNumber: '' }} />));
    fireEvent.click(screen.getByRole('button', { name: pl.company.submitSave }));
    await waitFor(() => expect(updateCompany).toHaveBeenCalledTimes(1), { timeout: 4000 });
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('agencja pracy: fokus na komunikacie sukcesu', async () => {
    vi.mocked(updateCompanyAgency).mockImplementation(() =>
      loseFocusDuringSave({ ok: true, outcome: 'saved' } as never),
    );
    render(
      wrap(<CompanyAgencyForm companyId={COMPANY_ID} isAgency={false} recognitionNumber={null} checkStatus="unchecked" />),
    );
    const save = screen.getByRole('button', { name: pl.company.agencySubmit });
    save.focus();
    fireEvent.click(save);
    const status = await screen.findByRole('status', {}, { timeout: 4000 });
    expect(status).toHaveTextContent(pl.company.agencySaved);
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('zapisz wyszukiwanie: fokus na komunikacie z linkiem do zarządzania', async () => {
    vi.mocked(saveSearchAction).mockImplementation(() => loseFocusDuringSave({ ok: true, created: true } as never));
    render(
      wrap(
        <SaveSearchButton locale="pl" filters={{} as never} query="?category=warehouse" name="Magazyn" loginNext="/oferty-pracy" />,
      ),
    );
    const save = screen.getByRole('button', { name: pl.savedSearches.save });
    save.focus();
    fireEvent.click(save);
    const status = await screen.findByRole('status', {}, { timeout: 4000 });
    expect(status).toHaveTextContent(pl.savedSearches.saved);
    await waitFor(() => expect(status).toHaveFocus());
  });

  it('zapisz wyszukiwanie bez sesji: fokus na komunikacie z linkiem logowania', async () => {
    vi.mocked(saveSearchAction).mockImplementation(() =>
      loseFocusDuringSave({ ok: false, error: 'UNAUTHENTICATED' } as never),
    );
    render(
      wrap(
        <SaveSearchButton locale="pl" filters={{} as never} query="?category=warehouse" name="Magazyn" loginNext="/oferty-pracy" />,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: pl.savedSearches.save }));
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert).toHaveTextContent(pl.savedSearches.loginRequired);
    await waitFor(() => expect(alert).toHaveFocus());
  });

  it('kontrola ujemna: bez zapisu komunikat nie kradnie fokusu', async () => {
    render(
      wrap(
        <SaveSearchButton locale="pl" filters={{} as never} query="?category=warehouse" name="Magazyn" loginNext="/oferty-pracy" />,
      ),
    );
    const save = screen.getByRole('button', { name: pl.savedSearches.save });
    save.focus();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(save).toHaveFocus();
  });
});

describe('formularz odwołania — Anuluj (#1243)', () => {
  it('„Anuluj” przywraca fokus na przycisk „Odwołaj się”', async () => {
    render(wrap(<AppealForm target={{ kind: 'decision', decisionId: COMPANY_ID }} messages="company" />));
    fireEvent.click(screen.getByRole('button', { name: pl.company.appealAction }));
    const textarea = await screen.findByRole('textbox', { name: pl.company.appealGroundsLabel });
    await waitFor(() => expect(textarea).toHaveFocus());

    const cancel = screen.getByRole('button', { name: pl.company.appealCancel });
    cancel.focus();
    fireEvent.click(cancel);

    const open = await screen.findByRole('button', { name: pl.company.appealAction });
    await waitFor(() => expect(open).toHaveFocus());
    expect(document.body).not.toHaveFocus();
  });

  it('kontrola ujemna: pierwsze wyświetlenie nie przenosi fokusu na przycisk', () => {
    render(wrap(<AppealForm target={{ kind: 'decision', decisionId: COMPANY_ID }} messages="company" />));
    expect(screen.getByRole('button', { name: pl.company.appealAction })).not.toHaveFocus();
  });
});
