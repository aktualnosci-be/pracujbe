import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobFunnelRangePicker, JobFunnelStats } from '@/components/employer/JobFunnelStats';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/** Panel lejka ofert (#99): zakres dat, definicja każdej metryki, rozbicie per oferta. */

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & {
    href: { pathname: string; query: Record<string, string> };
  }) => <a {...props} href={`${href.pathname}?${new URLSearchParams(href.query)}`}>{children}</a>,
}));

afterEach(cleanup);

const range = { days: 30 as const, from: '2026-08-26', to: '2026-09-24' };
const totals = { searchAppearances: 1250, detailViews: 31, applyStarted: 6, applicationsSubmitted: 3 };
const jobs = [
  { jobId: 'j1', title: 'Magazynier', slug: 'magazynier', status: 'active',
    searchAppearances: 1200, detailViews: 30, applyStarted: 6, applicationsSubmitted: 2 },
  { jobId: 'j2', title: '', slug: '', status: 'closed',
    searchAppearances: 50, detailViews: 1, applyStarted: 0, applicationsSubmitted: 1 },
];

describe('JobFunnelStats', () => {
  it.each([['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const)(
    '%s: shows the date range, every metric definition and the per-job table',
    (locale, messages) => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <JobFunnelStats range={range} totals={totals} jobs={jobs} locale={locale} />
        </NextIntlClientProvider>,
      );
      const t = messages.jobFunnel;
      const formatter = new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'Europe/Brussels' });
      expect(screen.getByTestId('job-funnel-range')).toHaveTextContent(formatter.format(new Date('2026-08-26T12:00:00Z')));
      expect(screen.getByTestId('job-funnel-range')).toHaveTextContent(formatter.format(new Date('2026-09-24T12:00:00Z')));
      for (const key of ['searchAppearancesDefinition', 'detailViewsDefinition', 'applyStartedDefinition',
        'applicationsSubmittedDefinition', 'privacyNote'] as const) {
        expect(screen.getByText(t[key])).toBeInTheDocument();
      }
      const table = screen.getByRole('table', { name: t.tableCaption });
      expect(within(table).getByRole('rowheader', { name: 'Magazynier' })).toBeInTheDocument();
      expect(within(table).getByRole('rowheader', { name: t.untitled })).toBeInTheDocument();
      // Przewijany region tabeli jest dostępny z klawiatury.
      expect(screen.getByRole('region', { name: t.tableRegion })).toHaveAttribute('tabindex', '0');
    },
  );

  it('shows an empty state instead of a table without data', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobFunnelStats range={range} totals={{ searchAppearances: 0, detailViews: 0, applyStarted: 0, applicationsSubmitted: 0 }} jobs={[]} locale="en" />
      </NextIntlClientProvider>,
    );
    expect(screen.getByText(en.jobFunnel.empty)).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
  });
});

describe('JobFunnelRangePicker', () => {
  it('links the offered ranges and marks the current one', () => {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobFunnelRangePicker range={{ days: 7, from: '2026-09-18', to: '2026-09-24' }} />
      </NextIntlClientProvider>,
    );
    const nav = screen.getByRole('navigation', { name: en.jobFunnel.rangeLabel });
    const links = within(nav).getAllByRole('link');
    expect(links.map((l) => l.getAttribute('href'))).toEqual([
      '/employer/statystyki?dni=7', '/employer/statystyki?dni=30', '/employer/statystyki?dni=90',
    ]);
    expect(within(nav).getByRole('link', { name: '7 days' })).toHaveAttribute('aria-current', 'page');
  });
});
