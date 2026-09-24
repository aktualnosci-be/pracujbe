import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { applyToJob } from '@/lib/actions/applications';
import en from '@/messages/en.json';

/**
 * #495 — numer NISS/BIS lub dokumentu w wiadomości: komunikat serwera przy polu wiadomości
 * (aria-invalid, fokus), wpisany tekst zostaje, pod polem stała podpowiedź.
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

async function submitWithMessage(message: string) {
  render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ApplyModal jobId="job-1" companyName="ACME" triggerLabel="Apply" />
    </NextIntlClientProvider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
  await screen.findByRole('dialog');
  fireEvent.change(document.getElementById('apply-phone')!, { target: { value: '470 12 34 56' } });
  fireEvent.change(document.getElementById('apply-message')!, { target: { value: message } });
  fireEvent.click(screen.getByRole('checkbox'));
  fireEvent.click(screen.getByRole('button', { name: en.apply.submit }));
}

describe('ApplyModal — identyfikatory w wiadomości (#495)', () => {
  it('pokazuje błąd przy polu wiadomości, ustawia fokus i zachowuje treść', async () => {
    vi.mocked(applyToJob).mockResolvedValue({
      ok: false,
      error: 'VALIDATION_FAILED',
      field: 'message',
      reason: 'sensitiveId',
    });
    await submitWithMessage('NISS 85.07.30-033.28');

    expect(await screen.findByText(en.apply.sensitiveIdNotAllowed)).toHaveAttribute('id', 'apply-message-error');
    const textarea = document.getElementById('apply-message')!;
    expect(textarea).toHaveAttribute('aria-invalid', 'true');
    expect(textarea.getAttribute('aria-describedby')).toContain('apply-message-error');
    expect(textarea).toHaveFocus();
    expect(textarea).toHaveValue('NISS 85.07.30-033.28');
    expect(screen.queryByText(en.apply.errorGeneric)).not.toBeInTheDocument();
  });

  it('podpowiedź pod polem jest widoczna i powiązana z polem przed wysłaniem', async () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ApplyModal jobId="job-1" companyName="ACME" triggerLabel="Apply" />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    await screen.findByRole('dialog');
    expect(screen.getByText(en.apply.sensitiveIdHint)).toHaveAttribute('id', 'apply-message-hint');
    expect(document.getElementById('apply-message')).toHaveAttribute('aria-describedby', 'apply-message-hint');
    expect(document.getElementById('apply-message')).not.toHaveAttribute('aria-invalid');
  });
});
