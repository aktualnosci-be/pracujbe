import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyLinksForm } from '@/components/employer/CompanyLinksForm';
import { updateCompanyLinks } from '@/lib/actions/company';
import pl from '@/messages/pl.json';

// jsdom nie implementuje scrollIntoView (komponent przewija do komunikatu po sukcesie/błędzie).
Element.prototype.scrollIntoView = vi.fn();

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/company', () => ({ updateCompanyLinks: vi.fn() }));
// jsdom nie ma layoutu obrazów — podgląd sprawdzamy przez sam fakt renderu <img>.
vi.mock('next/image', () => ({
  default: (props: Record<string, unknown>) => {
    // eslint-disable-next-line @next/next/no-img-element
    return <img alt={props.alt as string} src={props.src as string} />;
  },
}));

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

beforeEach(() => {
  vi.mocked(updateCompanyLinks).mockReset();
});

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

function renderForm(website = '', logoUrl = '', ownHost = 'pracuj.be') {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <CompanyLinksForm companyId={COMPANY_ID} defaultValues={{ website, logoUrl }} ownHost={ownHost} />
    </NextIntlClientProvider>,
  );
}

/**
 * Rozgrzewka: jedna nieudana walidacja przed testami (limit hooka 10 s). Pierwszy test płacił
 * jednorazowo kompilację JIT React Hook Form, resolvera Zod i formularza — pod obciążeniem
 * maszyny zbliżało to go do limitu 5 s. DOM jest potem czyszczony.
 */
beforeAll(async () => {
  renderForm();
  const field = screen.getByLabelText(pl.company.website);
  fireEvent.change(field, { target: { value: 'http://acme.example' } });
  fireEvent.click(screen.getByRole('button', { name: pl.company.linksSubmit }));
  await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
  cleanup();
});

/** Tanie czekanie na element (bez przeliczania ról całego drzewa co 50 ms); asercja roli po nim. */
async function waitForSelector(selector: string): Promise<void> {
  await waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
}

describe('CompanyLinksForm', () => {
  it('rejects a non-https address at the field, without calling the server', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(pl.company.website), {
      target: { value: 'http://acme.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: pl.company.linksSubmit }));

    const field = await screen.findByLabelText(pl.company.website);
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText(pl.company.error.urlInvalid)).toBeInTheDocument();
    expect(field).toHaveFocus();
    expect(updateCompanyLinks).not.toHaveBeenCalled();
  });

  it('saves both fields and shows a clear success message', async () => {
    vi.mocked(updateCompanyLinks).mockResolvedValue({ ok: true });
    renderForm();

    fireEvent.change(screen.getByLabelText(pl.company.website), {
      target: { value: 'https://acme.example' },
    });
    fireEvent.click(screen.getByRole('button', { name: pl.company.linksSubmit }));

    await waitFor(() => expect(updateCompanyLinks).toHaveBeenCalledWith(COMPANY_ID, {
      website: 'https://acme.example',
      logoUrl: '',
    }));
    await waitForSelector('[role="status"]');
    expect(screen.getByRole('status')).toHaveTextContent(pl.company.linksSavedSuccess);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('surfaces a server error without losing the entered value', async () => {
    vi.mocked(updateCompanyLinks).mockResolvedValue({ ok: false, error: 'RATE_LIMITED' });
    renderForm();

    fireEvent.change(screen.getByLabelText(pl.company.logoUrl), {
      target: { value: 'https://acme.example/logo.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: pl.company.linksSubmit }));

    await waitForSelector('[role="alert"]');
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByLabelText(pl.company.logoUrl)).toHaveValue('https://acme.example/logo.png');
  });

  it('previews the logo only when the address is on the site’s own host', () => {
    renderForm('', 'https://pracuj.be/og.png');
    expect(screen.getByRole('img', { name: pl.company.logoPreviewAlt })).toBeInTheDocument();
    cleanup();

    renderForm('', 'https://cdn.example.com/logo.png');
    expect(screen.queryByRole('img', { name: pl.company.logoPreviewAlt })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'https://cdn.example.com/logo.png' })).toBeInTheDocument();
  });
});
