import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { PublicSavedJobsProvider } from '@/components/public/PublicSavedJobs';
import { applyToJob } from '@/lib/actions/applications';
import { submitGuestApplication } from '@/lib/actions/guest-applications';
import { getPublicSavedJobs } from '@/lib/actions/public-saved-jobs';
import en from '@/messages/en.json';

/**
 * #913 — zamknięcie modalu (X/Escape) przed wysłaniem nie może wymazać wpisanych danych:
 * ani formularza zalogowanego kandydata (pola żyją w `ApplyModal`), ani gościa (`GuestApplyForm`
 * odmontowuje się razem z treścią dialogu — szkic musi przetrwać w `ApplyModal` przez
 * `initialDraft`/`onDraftChange`). Draft trwa TYLKO do udanej wysyłki — to sprawdza kontrola
 * ujemna niżej: bez rozróżnienia „zamknięte bez wysłania” / „wysłane” fix byłby zbyt szeroki
 * (formularz pokazywałby stare dane nawet po realnym zapisie).
 */

const JOB_ID = '11111111-1111-4111-8111-111111111111';

vi.mock('@/lib/actions/applications', () => ({ applyToJob: vi.fn() }));
vi.mock('@/lib/actions/guest-applications', () => ({ submitGuestApplication: vi.fn() }));
vi.mock('@/lib/actions/candidate', () => ({ toggleSavedJob: vi.fn() }));
vi.mock('@/lib/actions/public-saved-jobs', () => ({ getPublicSavedJobs: vi.fn() }));
vi.mock('next/navigation', () => ({ usePathname: () => '/pl/oferty-pracy/murarz-bruksela-1002' }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;
Element.prototype.scrollIntoView ??= function scrollIntoView() {};

afterEach(() => {
  cleanup();
  vi.mocked(getPublicSavedJobs).mockReset();
});
beforeEach(() => {
  vi.mocked(applyToJob).mockReset();
  vi.mocked(submitGuestApplication).mockReset();
});

async function openDialog() {
  fireEvent.click(screen.getByRole('button', { name: /Apply/ }));
  return screen.findByRole('dialog');
}

async function closeDialog() {
  fireEvent.click(screen.getByRole('button', { name: en.apply.close }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
}

describe('ApplyModal — szkic przeżywa zamknięcie modalu (#913)', () => {
  it('kandydat: X nie czyści telefonu/wiadomości, można wrócić i wysłać', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'candidate', savedIds: [] });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PublicSavedJobsProvider jobIds={[JOB_ID]}>
          <ApplyModal jobId={JOB_ID} companyName="ACME" triggerLabel="Apply" />
        </PublicSavedJobsProvider>
      </NextIntlClientProvider>,
    );

    let dialog = await openDialog();
    fireEvent.change(document.getElementById('apply-phone')!, { target: { value: '470123456' } });
    fireEvent.change(document.getElementById('apply-message')!, { target: { value: 'Jestem zainteresowany' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));

    await closeDialog();

    dialog = await openDialog();
    expect(document.getElementById('apply-phone')).toHaveValue('470123456');
    expect(document.getElementById('apply-message')).toHaveValue('Jestem zainteresowany');
    expect(within(dialog).getByRole('checkbox')).toBeChecked();

    // Formularz nadal działa i wysyła zachowane dane, nie puste pola.
    vi.mocked(applyToJob).mockResolvedValueOnce({ ok: true, id: 'app-1' });
    fireEvent.click(within(dialog).getByRole('button', { name: en.apply.submit }));
    await waitFor(() => expect(applyToJob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(applyToJob).mock.calls[0]![0]).toMatchObject({
      phone: '470123456',
      message: 'Jestem zainteresowany',
    });
  });

  it('kontrola ujemna: po UDANEJ wysyłce ponowne otwarcie NIE pokazuje starych danych', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'candidate', savedIds: [] });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PublicSavedJobsProvider jobIds={[JOB_ID]}>
          <ApplyModal jobId={JOB_ID} companyName="ACME" triggerLabel="Apply" />
        </PublicSavedJobsProvider>
      </NextIntlClientProvider>,
    );

    let dialog = await openDialog();
    fireEvent.change(document.getElementById('apply-phone')!, { target: { value: '470123456' } });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    vi.mocked(applyToJob).mockResolvedValueOnce({ ok: true, id: 'app-1' });
    fireEvent.click(within(dialog).getByRole('button', { name: en.apply.submit }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    dialog = await openDialog();
    expect(document.getElementById('apply-phone')).toHaveValue('');
    expect(within(dialog).getByRole('checkbox')).not.toBeChecked();
  });

  it('gość: X nie czyści imienia/e-maila/odpowiedzi, formularz wysyła zachowane dane', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'anonymous' });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PublicSavedJobsProvider jobIds={[JOB_ID]}>
          <ApplyModal jobId={JOB_ID} companyName="ACME" triggerLabel="Apply" />
        </PublicSavedJobsProvider>
      </NextIntlClientProvider>,
    );

    let dialog = await openDialog();
    const guestForm = await within(dialog).findByTestId('guest-apply-form');
    fireEvent.change(within(guestForm).getByRole('textbox', { name: new RegExp(en.guestApply.fullName) }), {
      target: { value: 'Anna Kowalska' },
    });
    fireEvent.change(within(guestForm).getByRole('textbox', { name: new RegExp(en.guestApply.email) }), {
      target: { value: 'anna@example.com' },
    });

    await closeDialog();

    dialog = await openDialog();
    const reopenedGuestForm = await within(dialog).findByTestId('guest-apply-form');
    expect(
      within(reopenedGuestForm).getByRole('textbox', { name: new RegExp(en.guestApply.fullName) }),
    ).toHaveValue('Anna Kowalska');
    expect(
      within(reopenedGuestForm).getByRole('textbox', { name: new RegExp(en.guestApply.email) }),
    ).toHaveValue('anna@example.com');
  });

  it('kontrola ujemna: po wysłaniu formularza gościa szkic nie wraca przy kolejnym otwarciu', async () => {
    vi.mocked(getPublicSavedJobs).mockResolvedValue({ status: 'anonymous' });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <PublicSavedJobsProvider jobIds={[JOB_ID]}>
          <ApplyModal jobId={JOB_ID} companyName="ACME" triggerLabel="Apply" />
        </PublicSavedJobsProvider>
      </NextIntlClientProvider>,
    );

    let dialog = await openDialog();
    let guestForm = await within(dialog).findByTestId('guest-apply-form');
    fireEvent.change(within(guestForm).getByRole('textbox', { name: new RegExp(en.guestApply.fullName) }), {
      target: { value: 'Anna Kowalska' },
    });
    fireEvent.change(within(guestForm).getByRole('textbox', { name: new RegExp(en.guestApply.email) }), {
      target: { value: 'anna@example.com' },
    });
    fireEvent.click(within(guestForm).getByRole('radio', { name: new RegExp(en.auth.ageBandAdult.replace('{age}', '18')) }));
    fireEvent.click(within(guestForm).getByRole('checkbox'));
    vi.mocked(submitGuestApplication).mockResolvedValueOnce({ ok: true });
    fireEvent.click(within(guestForm).getByRole('button', { name: en.apply.submit }));
    await screen.findByTestId('guest-apply-sent');

    await closeDialog();

    dialog = await openDialog();
    guestForm = await within(dialog).findByTestId('guest-apply-form');
    expect(
      within(guestForm).getByRole('textbox', { name: new RegExp(en.guestApply.fullName) }),
    ).toHaveValue('');
    expect(
      within(guestForm).getByRole('textbox', { name: new RegExp(en.guestApply.email) }),
    ).toHaveValue('');
  });
});
