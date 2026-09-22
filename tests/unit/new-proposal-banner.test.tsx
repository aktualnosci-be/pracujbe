import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewProposalBanner } from '@/components/candidate/NewProposalBanner';
import { findLatestActiveProposal } from '@/lib/candidate-offers';
import en from '@/messages/en.json';

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => (
    <a {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

function show(status: string, href = '/jobs/real-offer') {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <NewProposalBanner status={status} href={href} />
    </NextIntlClientProvider>,
  );
}

describe('NewProposalBanner', () => {
  it('sorts active proposals by sent_at and then by id', () => {
    const base = { status: 'sent', expiresAt: null };
    expect(
      findLatestActiveProposal([
        { ...base, id: 'z', sentAt: '2026-09-20T10:00:00Z' },
        { ...base, id: 'a', sentAt: '2026-09-21T10:00:00Z' },
        { ...base, id: 'b', sentAt: '2026-09-21T10:00:00Z' },
      ], new Date('2026-09-22T10:00:00Z')),
    ).toMatchObject({ id: 'b' });
  });

  it('excludes proposals at and before the expiry boundary', () => {
    const now = new Date('2026-09-22T10:00:00.000Z');
    expect(
      findLatestActiveProposal([
        { id: 'past', status: 'sent', sentAt: '2026-09-22T09:00:00Z', expiresAt: '2026-09-22T09:59:59Z' },
        { id: 'equal', status: 'viewed', sentAt: '2026-09-22T08:00:00Z', expiresAt: now.toISOString() },
        { id: 'future', status: 'sent', sentAt: '2026-09-22T07:00:00Z', expiresAt: '2026-09-22T10:00:00.001Z' },
      ], now),
    ).toMatchObject({ id: 'future' });
  });

  it('finds an active proposal behind more than twenty final records', () => {
    const finalOffers = Array.from({ length: 25 }, (_, index) => ({
      id: `final-${index}`,
      status: index % 2 ? 'accepted' : 'declined',
      sentAt: `2026-09-${String(22 - (index % 9)).padStart(2, '0')}T12:00:00Z`,
      expiresAt: null,
    }));
    expect(
      findLatestActiveProposal([
        ...finalOffers,
        { id: 'active', status: 'viewed', sentAt: '2026-09-01T12:00:00Z', expiresAt: null },
      ], new Date('2026-09-22T10:00:00Z')),
    ).toMatchObject({ id: 'active' });
  });

  it.each(['accepted', 'declined', 'withdrawn', 'expired'])(
    'does not render for the final status %s',
    (status) => {
      show(status);
      expect(
        screen.queryByText(en.dashboard.newOfferBanner),
      ).not.toBeInTheDocument();
    },
  );

  it.each(['sent', 'viewed'])(
    'uses the supplied real href for status %s and can be closed',
    (status) => {
      show(status);

      expect(
        screen.getByRole('link', { name: en.dashboard.viewOffer }),
      ).toHaveAttribute('href', '/jobs/real-offer');

      fireEvent.click(screen.getByRole('button', { name: en.nav.close }));
      expect(
        screen.queryByText(en.dashboard.newOfferBanner),
      ).not.toBeInTheDocument();
    },
  );
});
