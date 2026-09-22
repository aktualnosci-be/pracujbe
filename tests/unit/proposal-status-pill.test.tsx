import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { ProposalStatusPill } from '@/components/candidate/ProposalStatusPill';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

const messages = { pl, nl, fr, en };
const statuses = ['draft', 'sent', 'viewed', 'accepted', 'declined', 'expired', 'cancelled'] as const;

afterEach(cleanup);

describe('status propozycji', () => {
  for (const [locale, localeMessages] of Object.entries(messages)) {
    it.each(statuses)(`shows localized %s in ${locale}`, (status) => {
      render(
        <NextIntlClientProvider locale={locale} messages={localeMessages}>
          <ProposalStatusPill status={status} />
        </NextIntlClientProvider>,
      );
      expect(screen.getByText(localeMessages.offerStatus[status])).toBeInTheDocument();
      if (locale !== 'en') expect(screen.queryByText(status)).not.toBeInTheDocument();
    });

    it(`does not expose an unexpected database status in ${locale}`, () => {
      render(
        <NextIntlClientProvider locale={locale} messages={localeMessages}>
          <ProposalStatusPill status="future_internal_status" />
        </NextIntlClientProvider>,
      );
      expect(screen.getByText(localeMessages.offerStatus.unknown)).toBeInTheDocument();
      expect(screen.queryByText('future_internal_status')).not.toBeInTheDocument();
    });
  }

  it.each([
    ['accepted', 'bg-success/10'],
    ['declined', 'bg-error/10'],
    ['viewed', 'bg-warning/10'],
    ['sent', 'bg-primary/10'],
  ])('uses the semantic tone for %s', (status, tone) => {
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <ProposalStatusPill status={status} />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(pl.offerStatus[status as keyof typeof pl.offerStatus])).toHaveClass(tone);
  });
});
