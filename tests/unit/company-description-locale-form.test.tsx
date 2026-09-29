import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyDescriptionLocaleForm } from '@/components/employer/CompanyDescriptionLocaleForm';
import { updateCompanyDescriptionLocale } from '@/lib/actions/company-description-locale';
import pl from '@/messages/pl.json';

/**
 * Formularz języka opisu firmy (#708): pole z etykietą i podpowiedzią, zapis wybranego kodu,
 * błąd przy polu (aria-invalid + opis) przy braku opisu, jasny sukces; wybór zostaje po błędzie.
 */

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/company-description-locale', () => ({ updateCompanyDescriptionLocale: vi.fn() }));

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

function renderForm(locale: 'nl' | null = null) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <CompanyDescriptionLocaleForm companyId={COMPANY_ID} locale={locale} />
    </NextIntlClientProvider>,
  );
}

beforeEach(() => vi.mocked(updateCompanyDescriptionLocale).mockReset());
afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe('CompanyDescriptionLocaleForm', () => {
  it('pole z etykietą i podpowiedzią; cztery języki serwisu + „nie wskazano”', () => {
    renderForm('nl');
    const select = screen.getByLabelText(pl.company.descriptionLocaleLabel) as HTMLSelectElement;
    expect(select.value).toBe('nl');
    expect([...select.options].map((option) => option.value)).toEqual(['', 'pl', 'nl', 'fr', 'en']);
    expect(select.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(select.getAttribute('aria-describedby')!)?.textContent).toBe(
      pl.company.descriptionLocaleHint,
    );
  });

  it('zapis wybranego języka → akcja z kodem i komunikat sukcesu', async () => {
    vi.mocked(updateCompanyDescriptionLocale).mockResolvedValue({ ok: true, outcome: 'saved' });
    renderForm();
    fireEvent.change(screen.getByLabelText(pl.company.descriptionLocaleLabel), { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: pl.company.descriptionLocaleSubmit }));
    expect(await screen.findByRole('status')).toHaveTextContent(pl.company.descriptionLocaleSaved);
    expect(updateCompanyDescriptionLocale).toHaveBeenCalledWith(COMPANY_ID, 'fr');
    expect(refresh).toHaveBeenCalled();
  });

  it('kontrola ujemna: brak opisu → błąd przy polu, wybór zostaje, bez odświeżenia', async () => {
    vi.mocked(updateCompanyDescriptionLocale).mockResolvedValue({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'descriptionEmpty',
    });
    renderForm();
    const select = screen.getByLabelText(pl.company.descriptionLocaleLabel) as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'en' } });
    fireEvent.click(screen.getByRole('button', { name: pl.company.descriptionLocaleSubmit }));
    await waitFor(() => expect(select.getAttribute('aria-invalid')).toBe('true'));
    expect(screen.getByText(pl.company.descriptionLocaleDescriptionEmpty)).toBeInTheDocument();
    expect(select.value).toBe('en');
    expect(refresh).not.toHaveBeenCalled();
  });
});
