import * as React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProposalActions } from '@/components/candidate/ProposalActions';
import { canRespondToProposal } from '@/lib/candidate-offers';
import { respondToOffer } from '@/lib/actions/offers';
import en from '@/messages/en.json';

const router = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({ useRouter: () => router }));
vi.mock('@/lib/actions/offers', () => ({ respondToOffer: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
beforeEach(() => vi.resetAllMocks());

function show(
  status = 'sent',
  expiresAt: string | null = null,
  initialCanRespond = canRespondToProposal(status, expiresAt),
) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <ProposalActions
        offerId="11111111-1111-4111-8111-111111111111"
        expiresAt={expiresAt}
        initialCanRespond={initialCanRespond}
      />
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

  it.each([
    ['past', '2020-01-01T00:00:00.000Z'],
    ['equal', '2026-09-22T10:00:00.000Z'],
  ])('does not render actions when expiry is %s', (_label, expiresAt) => {
    vi.setSystemTime(new Date('2026-09-22T10:00:00.000Z'));
    show('sent', expiresAt);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each([null, '2026-09-22T10:00:00.001Z'])(
    'renders actions when expiry is %s',
    (expiresAt) => {
      vi.setSystemTime(new Date('2026-09-22T10:00:00.000Z'));
      show('viewed', expiresAt);
      expect(screen.getByRole('button', { name: en.dashboard.acceptProposal })).toBeVisible();
      expect(screen.getByRole('button', { name: en.dashboard.declineProposal })).toBeVisible();
    },
  );

  it('keeps the server decision on the first render and hides actions exactly at expiry', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-22T10:00:00.000Z'));

    show('sent', '2026-09-22T10:00:01.000Z', true);
    expect(screen.getByRole('button', { name: en.dashboard.acceptProposal })).toBeVisible();

    act(() => vi.advanceTimersByTime(999));
    expect(screen.getByRole('button', { name: en.dashboard.acceptProposal })).toBeVisible();

    act(() => vi.advanceTimersByTime(1));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not override a conservative server decision during the first render', () => {
    show('sent', '2999-01-01T00:00:00.000Z', false);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('renews the expiry timer when the delay exceeds the platform maximum', () => {
    vi.useFakeTimers();
    const now = new Date('2026-09-22T10:00:00.000Z');
    vi.setSystemTime(now);
    const maxTimeoutMs = 2_147_483_647;
    const expiresAt = new Date(now.getTime() + maxTimeoutMs + 1_000).toISOString();

    show('sent', expiresAt, true);
    act(() => vi.advanceTimersByTime(maxTimeoutMs));
    expect(screen.getByRole('button', { name: en.dashboard.acceptProposal })).toBeVisible();

    act(() => vi.advanceTimersByTime(1_000));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

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
    fireEvent.click(screen.getByRole('button', { name: en.dashboard.declineConfirm }));
    expect(await screen.findByText(en.errors.generic)).toBeVisible();
    expect(router.refresh).not.toHaveBeenCalled();
    await waitFor(() => expect(decline).toBeEnabled());

    fireEvent.click(decline);
    fireEvent.click(screen.getByRole('button', { name: en.dashboard.declineConfirm }));
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

  it('asks before declining: cancel sends nothing and returns focus to the trigger', async () => {
    show('sent');
    const decline = screen.getByRole('button', { name: en.dashboard.declineProposal });
    fireEvent.click(decline);

    const dialog = screen.getByRole('alertdialog', { name: en.dashboard.declineConfirmTitle });
    expect(dialog).toHaveTextContent(en.dashboard.declineConfirmDescription);
    expect(screen.getByRole('button', { name: en.common.cancel })).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: en.common.cancel }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(respondToOffer).not.toHaveBeenCalled();
    await waitFor(() => expect(decline).toHaveFocus());
  });

  it('confirmed decline calls the action once and announces the result', async () => {
    vi.mocked(respondToOffer).mockResolvedValue({ ok: true });
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <ProposalActions
          offerId="11111111-1111-4111-8111-111111111111"
          expiresAt={null}
          initialCanRespond
          jobTitle="Forklift driver"
        />
      </NextIntlClientProvider>,
    );
    fireEvent.click(screen.getByRole('button', { name: en.dashboard.declineProposal }));
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Forklift driver');
    const confirm = screen.getByRole('button', { name: en.dashboard.declineConfirm });
    fireEvent.click(confirm);
    fireEvent.click(confirm);

    await waitFor(() => expect(router.refresh).toHaveBeenCalledTimes(1));
    expect(respondToOffer).toHaveBeenCalledExactlyOnceWith(
      '11111111-1111-4111-8111-111111111111',
      false,
    );
    const status = await screen.findByRole('status');
    expect(status).toHaveTextContent(en.dashboard.declineProposalSuccess);
    await waitFor(() => expect(status).toHaveFocus());
  });

  describe('termin mija w trakcie wizyty (#830)', () => {
    const OFFER = '11111111-1111-4111-8111-111111111111';
    const START = new Date('2026-09-22T10:00:00.000Z');
    const EXPIRES = '2026-09-22T10:00:01.000Z';

    function showLive(props: Partial<React.ComponentProps<typeof ProposalActions>> = {}) {
      const element = (extra: Partial<React.ComponentProps<typeof ProposalActions>> = {}) => (
        <NextIntlClientProvider locale="en" messages={en}>
          <ProposalActions
            offerId={OFFER}
            expiresAt={EXPIRES}
            initialCanRespond
            status="sent"
            {...props}
            {...extra}
          />
        </NextIntlClientProvider>
      );
      const view = render(element());
      return { ...view, rerenderWith: (extra: Partial<React.ComponentProps<typeof ProposalActions>>) => view.rerender(element(extra)) };
    }

    function deferred<T>() {
      let resolve!: (value: T) => void;
      let reject!: (reason: unknown) => void;
      const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
      return { promise, resolve, reject };
    }

    const flush = async () => {
      await act(async () => {
        await Promise.resolve();
        vi.advanceTimersByTime(0);
      });
    };

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(START);
    });

    it('returned failure after expiry stays visible, refreshes the route and explains the missing actions', async () => {
      const request = deferred<{ ok: false; error: 'VALIDATION_FAILED' }>();
      vi.mocked(respondToOffer).mockReturnValue(request.promise);
      showLive();

      const accept = screen.getByRole('button', { name: en.dashboard.acceptProposal });
      fireEvent.click(accept);
      act(() => vi.advanceTimersByTime(1_000));

      // Trwające żądanie: przyciski zostają zablokowane, nowej odpowiedzi nie da się zacząć.
      expect(screen.getByRole('button', { name: en.dashboard.acceptProposal })).toBeDisabled();
      fireEvent.click(screen.getByRole('button', { name: en.dashboard.acceptProposal }));
      expect(respondToOffer).toHaveBeenCalledTimes(1);

      await act(async () => request.resolve({ ok: false, error: 'VALIDATION_FAILED' }));
      await flush();

      expect(screen.getByText(en.errors.generic)).toBeVisible();
      expect(router.refresh).toHaveBeenCalledTimes(1);
      const notice = screen.getByText(en.dashboard.proposalExpiredNotice);
      expect(notice).toHaveAttribute('role', 'status');
      expect(notice).toHaveFocus();
      expect(screen.queryByRole('button', { name: en.dashboard.acceptProposal })).not.toBeInTheDocument();
    });

    it('thrown failure after expiry keeps the error and refreshes the route', async () => {
      const request = deferred<{ ok: true }>();
      vi.mocked(respondToOffer).mockReturnValue(request.promise);
      showLive();

      fireEvent.click(screen.getByRole('button', { name: en.dashboard.acceptProposal }));
      act(() => vi.advanceTimersByTime(1_000));
      await act(async () => request.reject(new Error('transport')));
      await flush();

      expect(screen.getByText(en.errors.generic)).toBeVisible();
      expect(screen.getByText(en.dashboard.proposalExpiredNotice)).toBeVisible();
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it('success committed before expiry is announced, without the expiry notice', async () => {
      const request = deferred<{ ok: true }>();
      vi.mocked(respondToOffer).mockReturnValue(request.promise);
      showLive();

      fireEvent.click(screen.getByRole('button', { name: en.dashboard.acceptProposal }));
      act(() => vi.advanceTimersByTime(1_000));
      await act(async () => request.resolve({ ok: true }));
      await flush();

      expect(screen.getByText(en.dashboard.acceptProposalSuccess)).toBeVisible();
      expect(screen.queryByText(en.dashboard.proposalExpiredNotice)).not.toBeInTheDocument();
      expect(screen.queryByText(en.errors.generic)).not.toBeInTheDocument();
      expect(router.refresh).toHaveBeenCalledTimes(1);
    });

    it('open decline dialog without a request closes at expiry and focus lands on the notice', async () => {
      const onExpire = vi.fn();
      showLive({ onExpire });
      fireEvent.click(screen.getByRole('button', { name: en.dashboard.declineProposal }));
      expect(screen.getByRole('alertdialog')).toBeVisible();

      act(() => vi.advanceTimersByTime(1_000));
      await flush();

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      const notice = screen.getByText(en.dashboard.proposalExpiredNotice);
      expect(notice).toHaveFocus();
      expect(respondToOffer).not.toHaveBeenCalled();
      expect(onExpire).toHaveBeenCalledTimes(1);
    });

    it('confirmation already in progress stays open until the result, then shows the error', async () => {
      const request = deferred<{ ok: false; error: 'VALIDATION_FAILED' }>();
      vi.mocked(respondToOffer).mockReturnValue(request.promise);
      showLive();
      fireEvent.click(screen.getByRole('button', { name: en.dashboard.declineProposal }));
      fireEvent.click(screen.getByRole('button', { name: en.dashboard.declineConfirm }));

      act(() => vi.advanceTimersByTime(1_000));
      expect(screen.getByRole('alertdialog')).toBeVisible();
      expect(screen.getByRole('button', { name: en.dashboard.declineConfirm })).toBeDisabled();

      await act(async () => request.resolve({ ok: false, error: 'VALIDATION_FAILED' }));
      await flush();

      expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
      expect(screen.getByText(en.errors.generic)).toBeVisible();
      expect(screen.getByText(en.dashboard.proposalExpiredNotice)).toHaveFocus();
      expect(respondToOffer).toHaveBeenCalledExactlyOnceWith(OFFER, false);
    });

    it('server status after the refresh turns a transport error into the saved answer', async () => {
      const request = deferred<{ ok: true }>();
      vi.mocked(respondToOffer).mockReturnValue(request.promise);
      const view = showLive();

      fireEvent.click(screen.getByRole('button', { name: en.dashboard.acceptProposal }));
      act(() => vi.advanceTimersByTime(1_000));
      await act(async () => request.reject(new Error('transport')));
      await flush();
      expect(screen.getByText(en.errors.generic)).toBeVisible();

      // Odświeżona trasa: odpowiedź zdążyła się zapisać przed terminem.
      view.rerenderWith({ status: 'accepted', initialCanRespond: false });
      await flush();

      expect(screen.getByText(en.dashboard.acceptProposalSuccess)).toBeVisible();
      expect(screen.queryByText(en.errors.generic)).not.toBeInTheDocument();
      expect(screen.queryByText(en.dashboard.proposalExpiredNotice)).not.toBeInTheDocument();
    });

    it('an answer saved earlier is not announced as a new success on page load', () => {
      showLive({ status: 'accepted', initialCanRespond: false });
      expect(screen.queryByRole('status')).not.toBeInTheDocument();
      expect(screen.queryByRole('button')).not.toBeInTheDocument();
    });
  });
});
