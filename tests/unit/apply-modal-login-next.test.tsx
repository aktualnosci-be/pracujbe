import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { applyToJob } from '@/lib/actions/applications';
import en from '@/messages/en.json';

/**
 * Anonim, który próbuje aplikować, dostaje link logowania z `?next=` wskazującym bieżącą ofertę —
 * po zalogowaniu wraca na nią zamiast do panelu (#223).
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

afterEach(cleanup);

describe('ApplyModal — wymagane logowanie', () => {
  it('link logowania wraca na bieżącą ofertę', async () => {
    vi.mocked(applyToJob).mockResolvedValue({ ok: false, error: 'PERMISSION_DENIED' } as Awaited<
      ReturnType<typeof applyToJob>
    >);
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ApplyModal jobId="job-1" companyName="ACME" triggerLabel="Apply" />
      </NextIntlClientProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    await screen.findByRole('dialog');
    fireEvent.change(document.getElementById('apply-phone')!, {
      target: { value: '470000000' },
    });
    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: en.apply.submit }));

    const link = await screen.findByRole('link', { name: en.apply.loginRequired });
    expect(link).toHaveAttribute(
      'href',
      '/logowanie?next=%2Fpl%2Foferty-pracy%2Fmurarz-bruksela-1002',
    );
  });
});
