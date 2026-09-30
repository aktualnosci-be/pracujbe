import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CompanyDescriptionForm } from '@/components/employer/CompanyDescriptionForm';
import { updateCompanyDescription } from '@/lib/actions/company';
import type { CompanyDescriptionReview } from '@/lib/company-description';
import pl from '@/messages/pl.json';

Element.prototype.scrollIntoView = vi.fn();

const refresh = vi.fn();
vi.mock('@/i18n/navigation', () => ({ useRouter: () => ({ refresh }) }));
vi.mock('@/lib/actions/company', () => ({ updateCompanyDescription: vi.fn() }));

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

beforeEach(() => {
  vi.mocked(updateCompanyDescription).mockReset();
});

const COMPANY_ID = '11111111-1111-4111-8111-111111111111';

function renderForm(
  defaultValue = '',
  review: CompanyDescriptionReview | null = null,
  published: string | null = null,
) {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <CompanyDescriptionForm
        companyId={COMPANY_ID}
        companyName="Acme"
        defaultValue={defaultValue}
        published={published}
        review={review}
      />
    </NextIntlClientProvider>,
  );
}

async function waitForSelector(selector: string): Promise<void> {
  await waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
}

describe('CompanyDescriptionForm', () => {
  it('shows the limit and the moderation rule before saving, plus a live preview', () => {
    renderForm('Zaczynamy.');
    expect(screen.getByText(/10 z 1500 znaków/)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(pl.company.descriptionModerationHint.slice(0, 30)))).toBeInTheDocument();
    const preview = screen.getByTestId('company-description-preview');
    expect(preview).toHaveTextContent('Acme');
    expect(preview).toHaveTextContent('Zaczynamy.');

    fireEvent.change(screen.getByLabelText(pl.company.descriptionLabel), { target: { value: 'Nowy tekst' } });
    expect(screen.getByTestId('company-description-preview')).toHaveTextContent('Nowy tekst');
  });

  it('renders markup as plain text in the preview (no HTML)', () => {
    renderForm('<img src=x onerror=alert(1)>');
    const preview = screen.getByTestId('company-description-preview');
    expect(preview.querySelector('img')).toBeNull();
    expect(preview).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('rejects a text over the limit at the field, without calling the server', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(pl.company.descriptionLabel), { target: { value: 'x'.repeat(1501) } });
    fireEvent.click(screen.getByRole('button', { name: pl.company.descriptionSubmit }));
    const field = await screen.findByLabelText(pl.company.descriptionLabel);
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'));
    expect(screen.getByText(pl.company.error.descriptionTooLong)).toBeInTheDocument();
    expect(updateCompanyDescription).not.toHaveBeenCalled();
  });

  it('rejects an identification number at the field, without calling the server', async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText(pl.company.descriptionLabel), {
      target: { value: 'Kontakt: 85.07.30-033-28' },
    });
    fireEvent.click(screen.getByRole('button', { name: pl.company.descriptionSubmit }));
    await waitFor(() => expect(screen.getByText(pl.company.error.descriptionSensitive)).toBeInTheDocument());
    expect(updateCompanyDescription).not.toHaveBeenCalled();
  });

  it('saves a new text and says it waits for the administrator', async () => {
    vi.mocked(updateCompanyDescription).mockResolvedValue({ ok: true, outcome: 'pending' });
    renderForm();
    fireEvent.change(screen.getByLabelText(pl.company.descriptionLabel), { target: { value: 'Nowy opis.' } });
    fireEvent.click(screen.getByRole('button', { name: pl.company.descriptionSubmit }));
    await waitFor(() =>
      expect(updateCompanyDescription).toHaveBeenCalledWith(COMPANY_ID, { description: 'Nowy opis.' }),
    );
    await waitForSelector('[role="status"]');
    expect(screen.getByRole('status')).toHaveTextContent(pl.company.descriptionSubmittedPending);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it('surfaces a server error without losing the entered text', async () => {
    vi.mocked(updateCompanyDescription).mockResolvedValue({ ok: false, error: 'RATE_LIMITED' });
    renderForm();
    fireEvent.change(screen.getByLabelText(pl.company.descriptionLabel), { target: { value: 'Zachowaj mnie' } });
    fireEvent.click(screen.getByRole('button', { name: pl.company.descriptionSubmit }));
    await waitForSelector('[role="alert"]');
    expect(screen.getByLabelText(pl.company.descriptionLabel)).toHaveValue('Zachowaj mnie');
  });

  it('shows the rejection reason and the still-public description for a rejected proposal', () => {
    renderForm('Odrzucony tekst', {
      status: 'rejected',
      text: 'Odrzucony tekst',
      submittedAt: '2026-09-29 10:00:00+00',
      reason: 'Dane kontaktowe.',
    }, 'Opublikowany opis');
    const box = screen.getByTestId('company-description-review');
    expect(box).toHaveTextContent('Dane kontaktowe.');
    expect(box).toHaveTextContent('Opublikowany opis');
    expect(box).toHaveTextContent(pl.company.descriptionReviewRejectedTitle);
  });

  it('shows the pending state, and nothing when there is no proposal (negative control)', () => {
    renderForm('Czeka', { status: 'pending', text: 'Czeka', submittedAt: '2026-09-29 10:00:00+00', reason: null }, null);
    expect(screen.getByTestId('company-description-review')).toHaveTextContent(
      pl.company.descriptionReviewPendingTitle,
    );
    cleanup();
    renderForm('Opublikowany', null, 'Opublikowany');
    expect(screen.queryByTestId('company-description-review')).toBeNull();
  });
});
