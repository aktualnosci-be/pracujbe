import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { applyToJob } from '@/lib/actions/applications';
import en from '@/messages/en.json';

/**
 * #145 — błąd numeru z serwera trafia do pola telefonu (komunikat, aria-invalid, fokus), a do
 * akcji idą osobno numer i kraj (bez doklejania prefiksu w kliencie). Tryb demo ma własny komunikat.
 */

vi.mock('@/lib/actions/applications', () => ({ applyToJob: vi.fn() }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/pl/oferty-pracy/murarz-bruksela-1002',
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({
    children,
    href,
    ...props
  }: Omit<React.ComponentProps<'a'>, 'href'> & {
    href: string | { pathname: string; query: Record<string, string> };
  }) => (
    <a
      {...props}
      href={
        typeof href === 'string'
          ? href
          : `${href.pathname}?${new URLSearchParams(href.query).toString()}`
      }
    >
      {children}
    </a>
  ),
}));

// jsdom nie ma ResizeObserver (używa go Radix Checkbox/Select).
globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

// jsdom nie implementuje scrollIntoView (przewijanie do błędnego pola).
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

afterEach(cleanup);

function submit(phone: string) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ApplyModal jobId="job-1" companyName="ACME" triggerLabel="Apply" />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
  return screen.findByRole('dialog').then(() => {
    fireEvent.change(document.getElementById('apply-phone')!, { target: { value: phone } });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: en.apply.submit }));
  });
}

describe('ApplyModal — phone validation', () => {
  it('shows the server phone error on the field and focuses it', async () => {
    vi.mocked(applyToJob).mockResolvedValue({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'phone',
    });
    await submit('------');

    expect(await screen.findByText(en.apply.phoneInvalid)).toHaveAttribute('id', 'apply-phone-error');
    const input = document.getElementById('apply-phone')!;
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAttribute('aria-describedby', 'apply-phone-error');
    expect(input).toHaveFocus();
    expect(screen.queryByText(en.apply.errorGeneric)).not.toBeInTheDocument();
  });

  it('sends the number and the selected country separately', async () => {
    vi.mocked(applyToJob).mockResolvedValue({ ok: true, id: 'a-1' });
    await submit('+32 470 12 34 56');
    expect(applyToJob).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+32 470 12 34 56', phoneCountry: 'PL' }),
    );
  });

  it('explains that applying is off in the demo', async () => {
    vi.mocked(applyToJob).mockResolvedValue({ ok: false, error: 'DEMO_UNAVAILABLE' });
    await submit('470 12 34 56');
    expect(await screen.findByRole('alert')).toHaveTextContent(en.apply.demoUnavailable);
  });
});
