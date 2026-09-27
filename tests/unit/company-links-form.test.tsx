import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function renderForm(website = '', logoUrl = '', ownHost = 'pracuj.be') {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <CompanyLinksForm defaultValues={{ website, logoUrl }} ownHost={ownHost} />
    </NextIntlClientProvider>,
  );
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

    await waitFor(() => expect(updateCompanyLinks).toHaveBeenCalledWith({
      website: 'https://acme.example',
      logoUrl: '',
    }));
    expect(await screen.findByRole('status')).toHaveTextContent(pl.company.linksSavedSuccess);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('surfaces a server error without losing the entered value', async () => {
    vi.mocked(updateCompanyLinks).mockResolvedValue({ ok: false, error: 'RATE_LIMITED' });
    renderForm();

    fireEvent.change(screen.getByLabelText(pl.company.logoUrl), {
      target: { value: 'https://acme.example/logo.png' },
    });
    fireEvent.click(screen.getByRole('button', { name: pl.company.linksSubmit }));

    await screen.findByRole('alert');
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
