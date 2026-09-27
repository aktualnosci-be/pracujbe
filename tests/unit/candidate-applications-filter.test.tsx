import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CandidateApplicationsFilter } from '@/components/candidate/CandidateApplicationsFilter';
import {
  APPLICATION_FILTER_LABEL_KEYS,
  APPLICATION_FILTER_STATUSES,
  APPLICATION_FILTERS,
  APPLICATION_STATUSES,
  applicationFilterHref,
  matchesApplicationFilter,
  parseApplicationFilter,
} from '@/lib/candidate-application-filter';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

describe('application stage filter (#809)', () => {
  it('lists exactly the application_status enum from the first migration', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0001_extensions_and_enums.sql'), 'utf-8');
    const match = /create type application_status as enum \(([^)]*)\)/.exec(sql);
    expect(match).not.toBeNull();
    const fromSql = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect([...APPLICATION_STATUSES]).toEqual(fromSql);
  });

  it('stages are disjoint and cover every status except draft', () => {
    const grouped = Object.values(APPLICATION_FILTER_STATUSES).flat();
    expect(new Set(grouped).size).toBe(grouped.length);
    expect(new Set(grouped)).toEqual(new Set(APPLICATION_STATUSES.filter((status) => status !== 'draft')));
  });

  it('parses only known URL values, first value wins', () => {
    expect(parseApplicationFilter('rozmowa')).toBe('rozmowa');
    expect(parseApplicationFilter(['zakonczone', 'aktywne'])).toBe('zakonczone');
    for (const bad of [undefined, '', 'interview', 'ROZMOWA', 'aktywne,zakonczone', [] as string[]]) {
      expect(parseApplicationFilter(bad)).toBeNull();
    }
  });

  it('matches statuses like the SQL condition; no filter = everything', () => {
    expect(matchesApplicationFilter('interview', 'rozmowa')).toBe(true);
    expect(matchesApplicationFilter('interview', 'aktywne')).toBe(false);
    expect(matchesApplicationFilter('withdrawn', 'zakonczone')).toBe(true);
    expect(matchesApplicationFilter('draft', null)).toBe(true);
    expect(APPLICATION_FILTERS.some((filter) => matchesApplicationFilter('draft', filter))).toBe(false);
  });

  it('every stage label exists in all four languages', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = JSON.parse(readFileSync(resolve(process.cwd(), `src/messages/${locale}.json`), 'utf-8')) as {
        dashboard: Record<string, string>;
      };
      for (const key of [...Object.values(APPLICATION_FILTER_LABEL_KEYS), 'applicationsFilterAll', 'applicationsFilterLabel']) {
        expect(messages.dashboard[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });

  it('renders a named nav of links with the current stage marked', () => {
    render(<CandidateApplicationsFilter current="propozycja" />);
    const nav = screen.getByRole('navigation', { name: 'applicationsFilterLabel' });
    const links = [...nav.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/candidate/aplikacje',
      '/candidate/aplikacje?etap=aktywne',
      '/candidate/aplikacje?etap=rozmowa',
      '/candidate/aplikacje?etap=propozycja',
      '/candidate/aplikacje?etap=zakonczone',
    ]);
    const current = links.filter((a) => a.getAttribute('aria-current') === 'page');
    expect(current.map((a) => a.textContent)).toEqual(['applicationsFilterOffer']);
    // Bez listy (<ul>): karty zgłoszeń liczone są jako `listitem` w E2E.
    expect(nav.querySelector('li')).toBeNull();
  });

  it('marks "All" when there is no filter', () => {
    render(<CandidateApplicationsFilter current={null} />);
    expect(screen.getByRole('link', { name: 'applicationsFilterAll' })).toHaveAttribute('aria-current', 'page');
    expect(applicationFilterHref(null)).toBe('/candidate/aplikacje');
  });
});
