import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProposalActions } from '@/components/candidate/ProposalActions';
import { respondToOffer } from '@/lib/actions/offers';
import en from '@/messages/en.json';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/actions/offers', () => ({ respondToOffer: vi.fn() }));

afterEach(cleanup);
beforeEach(() => vi.resetAllMocks());

function show(status = 'sent') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProposalActions offerId="11111111-1111-4111-8111-111111111111" status={status} />
    </NextIntlClientProvider>,
  );
}

describe('ProposalActions', () => {
  it.each(['accepted', 'declined', 'expired', 'cancelled', 'draft'])(
    'does not render actions for final status %s',
    (status) => {
      show(status);
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    },
  );

  it('allows only one request while the first click is unresolved and refreshes once', async () => {
    let resolveRequest!: (result: { ok: true }) => void;
    vi.mocked(respondToOffer).mockImplementation(
      () => new Promise((resolve) => { resolveRequest = resolve; }),
    );
    show('viewed');

    const accept = screen.getByRole('button', { name: en.dashboard.acceptProposal });
    const decline = screen.getByRole('button', { name: en.dashboard.declineProposal });
    fireEvent.click(accept);
    fireEvent.click(accept);

    expect(respondToOffer).toHaveBeenCalledExactlyOnceWith(
      '11111111-1111-4111-8111-111111111111',
      true,
    );
    await waitFor(() => {
      expect(accept).toBeDisabled();
      expect(decline).toBeDisabled();
    });

    await act(async () => resolveRequest({ ok: true }));
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
  });

  it('shows a localized error for a returned failure, does not refresh and allows retry', async () => {
    vi.mocked(respondToOffer)
      .mockResolvedValueOnce({ ok: false, error: 'VALIDATION_FAILED' })
      .mockResolvedValueOnce({ ok: true });
    show();

    const decline = screen.getByRole('button', { name: en.dashboard.declineProposal });
    fireEvent.click(decline);
    expect(await screen.findByText(en.errors.generic)).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(decline).toBeEnabled());

    fireEvent.click(decline);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(respondToOffer).toHaveBeenCalledTimes(2);
  });

  it('turns a thrown failure into the localized error and releases the guard', async () => {
    vi.mocked(respondToOffer)
      .mockRejectedValueOnce(new Error('transport'))
      .mockResolvedValueOnce({ ok: true });
    show();

    const accept = screen.getByRole('button', { name: en.dashboard.acceptProposal });
    fireEvent.click(accept);
    expect(await screen.findByText(en.errors.generic)).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(accept).toBeEnabled());

    fireEvent.click(accept);
    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(respondToOffer).toHaveBeenCalledTimes(2);
  });
});
