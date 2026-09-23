import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import { getPublicSavedJobs } from '@/lib/actions/public-saved-jobs';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #303 — gość po kliknięciu „Aplikuj” od razu widzi wybór „załóż profil / zaloguj się”
 * z powrotem na ofertę, a nie formularz, który i tak odrzuci po wysłaniu.
 */

const JOB_PATH = '/pl/oferty-pracy/murarz-bruksela-1002';
const NEXT = encodeURIComponent(JOB_PATH);
const JOB_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/actions/applications', () => ({ applyToJob: vi.fn() }));
vi.mock('@/lib/actions/candidate', () => ({ toggleSavedJob: vi.fn() }));
vi.mock('@/lib/actions/public-saved-jobs', () => ({ getPublicSavedJobs: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => JOB_PATH }));
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

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.mocked(getPublicSavedJobs).mockReset();
});

function renderModal(locale: string, messages: typeof en) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages}>
      <PublicSavedJobsProvider jobIds={[JOB_ID]}>
        <ApplyModal jobId={JOB_ID} companyName="ACME" triggerLabel="Apply" />
      </PublicSavedJobsProvider>
    </NextIntlClientProvider>,
  );
}

describe('ApplyModal — gość (#303)', () => {
  for (const [locale, messages] of Object.entries({ pl, nl, fr, en })) {
    it(`gość widzi rejestrację i logowanie z powrotem na ofertę, bez formularza (${locale})`, async () => {
      vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'anonymous' });
      renderModal(locale, messages as typeof en);

      fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
      const dialog = await screen.findByRole('dialog');
      const guest = await within(dialog).findByTestId('apply-guest');

      expect(within(guest).getByRole('link', { name: messages.apply.guestRegister })).toHaveAttribute(
        'href',
        `/rejestracja?next=${NEXT}`,
      );
      expect(within(guest).getByRole('link', { name: messages.apply.guestLogin })).toHaveAttribute(
        'href',
        `/logowanie?next=${NEXT}`,
      );
      expect(dialog).toHaveTextContent(messages.apply.guestSubtitle);
      // Bez formularza i bez tekstów o „danych z profilu”.
      expect(document.getElementById('apply-phone')).toBeNull();
      expect(within(dialog).queryByRole('button', { name: messages.apply.submit })).toBeNull();
      expect(dialog).not.toHaveTextContent(messages.apply.profileNote);
      expect(dialog).not.toHaveTextContent(messages.apply.subtitle);
    });
  }

  it('kontrola ujemna: zalogowany kandydat nadal dostaje formularz', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'candidate', savedIds: [] });
    renderModal('en', en);

    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('button', { name: en.apply.submit });
    expect(document.getElementById('apply-phone')).not.toBeNull();
    expect(within(dialog).queryByTestId('apply-guest')).toBeNull();
    expect(dialog).toHaveTextContent(en.apply.profileNote);
  });

  it('podczas sprawdzania sesji formularz nie jest jeszcze pokazywany', async () => {
    vi.mocked(getPublicSavedJobs).mockReturnValue(new Promise(() => {}));
    renderModal('en', en);

    fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('status')).toHaveTextContent(en.common.loading);
    expect(document.getElementById('apply-phone')).toBeNull();
  });
});
