import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { applyToJob } from '@/lib/actions/applications';
import en from '@/messages/en.json';

/**
 * #360 — wyjątek z akcji (sieć) nie zostawia modalu w „Wysyłanie…”: przycisk wraca, jest komunikat,
 * dane zostają, a ponowienie wysyła ten sam klucz idempotencji.
 * #361 — ponowna aplikacja, konto nie-kandydata, limit i nieaktywna oferta mają własne komunikaty;
 * link logowania tylko przy braku sesji.
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

beforeEach(() => vi.mocked(applyToJob).mockReset());

describe('ApplyModal — błąd sieci (#360)', () => {
  it('po odrzuconym żądaniu odblokowuje przycisk, pokazuje komunikat i zachowuje dane', async () => {
    vi.mocked(applyToJob).mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await submit('470123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(en.apply.errorNetwork);
    const button = screen.getByRole('button', { name: en.apply.submit });
    expect(button).toBeEnabled();
    expect(document.getElementById('apply-phone')).toHaveValue('470123456');
  });

  it('ponowienie po błędzie wysyła ten sam klucz idempotencji', async () => {
    vi.mocked(applyToJob)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: true, id: 'a-1' });
    await submit('470123456');
    await screen.findByRole('alert');
    fireEvent.click(screen.getByRole('button', { name: en.apply.submit }));
    await waitFor(() => expect(applyToJob).toHaveBeenCalledTimes(2));

    const [first, second] = vi.mocked(applyToJob).mock.calls;
    expect(first![0].idempotencyKey).toBeTruthy();
    expect(second![0].idempotencyKey).toBe(first![0].idempotencyKey);
  });
});

describe('ApplyModal — komunikaty wyniku (#361)', () => {
  it('ponowna aplikacja: „Już aplikowałeś” z linkiem do historii, bez toastu sukcesu', async () => {
    vi.mocked(applyToJob).mockResolvedValue({ ok: false, error: 'APPLICATION_ALREADY_EXISTS' });
    await submit('470123456');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(en.apply.alreadyApplied);
    expect(screen.getByRole('link', { name: en.apply.viewApplications })).toHaveAttribute(
      'href',
      '/candidate/aplikacje',
    );
    expect(screen.queryByText(en.apply.success)).toBeNull();
  });

  it('zalogowany nie-kandydat nie widzi linku logowania', async () => {
    vi.mocked(applyToJob).mockResolvedValue({ ok: false, error: 'PERMISSION_DENIED' });
    await submit('470123456');

    expect(await screen.findByRole('alert')).toHaveTextContent(en.apply.candidateOnly);
    expect(screen.queryByRole('link', { name: en.apply.loginRequired })).toBeNull();
  });

  it.each([
    ['RATE_LIMITED', en.errors.rateLimited],
    ['JOB_NOT_ACTIVE', en.errors.jobNotActive],
  ] as const)('%s ma własny komunikat', async (error, text) => {
    vi.mocked(applyToJob).mockResolvedValue({ ok: false, error });
    await submit('470123456');
    expect(await screen.findByRole('alert')).toHaveTextContent(text);
  });
});
