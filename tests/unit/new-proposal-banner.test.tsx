import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { NewProposalBanner } from '@/components/candidate/NewProposalBanner';
import { findNewProposal } from '@/lib/candidate-offers';
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
  it('selects only a real proposal that still awaits a response', () => {
    expect(findNewProposal([])).toBeNull();
    expect(findNewProposal([{ id: 'old', status: 'accepted' }])).toBeNull();
    expect(findNewProposal([{ id: 'old', status: 'declined' }])).toBeNull();
    expect(
      findNewProposal([
        { id: 'finished', status: 'accepted' },
        { id: 'real', status: 'viewed' },
      ]),
    ).toEqual({ id: 'real', status: 'viewed' });
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
