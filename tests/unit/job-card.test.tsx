import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { JobCard } from '@/components/public/JobCard';
import type { JobListItem } from '@/lib/jobs';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';

vi.mock('@/lib/actions/public-saved-jobs', () => ({ getPublicSavedJobs: vi.fn() }));
vi.mock('@/lib/actions/candidate', () => ({ toggleSavedJob: vi.fn() }));

vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, ...props }: React.ComponentProps<'a'>) => <a {...props}>{children}</a>,
}));

afterEach(cleanup);

const job: JobListItem = {
  id: 'test-job', slug: 'electrician', title: 'Electrician', companyName: 'Test Company',
  companyVerified: true, city: 'Antwerp', region: 'Flanders', contractType: 'permanent',
  currency: 'EUR', salaryPeriod: 'month', publishedAt: '2026-09-20T10:00:00Z', isNew: true,
  highlights: ['Transport'], category: 'technical', accommodation: false,
  immediate: false, noLanguageRequired: false,
};
const messages = { pl, en, nl, fr };

function renderCard(overrides: Partial<JobListItem> = {}, locale: keyof typeof messages = 'en', matchScore?: number) {
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Europe/Brussels">
      <JobCard job={{ ...job, ...overrides }} showMatch={matchScore !== undefined} matchScore={matchScore} />
    </NextIntlClientProvider>,
  );
}

describe('Paszport oferty', () => {
  it('bez stawki pomija całe pole i zachowuje miejsce oraz warunki', () => {
    const { container } = renderCard();
    expect([...container.querySelectorAll('dt')].map((el) => el.textContent)).toEqual(['Location', 'Conditions']);
    expect(screen.getByText('Antwerp')).toBeVisible();
    expect(screen.getByText('Flanders')).toBeVisible();
    expect(screen.getByText(en.contractTypes.permanent)).toBeVisible();
    expect(screen.getByText('Transport')).toBeVisible();
    expect(screen.queryByText(en.job.salaryNotProvided)).not.toBeInTheDocument();
  });

  it.each([
    [{ salaryMin: 18.75, salaryMax: 22.5, salaryPeriod: 'hour' as const }, '€18.75 – €22.5 gross / hour'],
    [{ salaryMin: 18.75, salaryPeriod: 'month' as const }, 'from €18.75 gross / month'],
    [{ salaryMax: 22.5, salaryPeriod: 'year' as const }, 'up to €22.5 gross / year'],
    [{ salaryMin: 0, salaryPeriod: 'hour' as const }, 'from €0 gross / hour'],
  ])('pokazuje podane granice i okres: %j', (salary, expected) => {
    const { container } = renderCard(salary);
    const salaryField = screen.getByText('Salary', { selector: 'dt' }).parentElement!;
    expect(within(salaryField).getByText(expected)).toBeVisible();
    expect(container.querySelectorAll('dt')).toHaveLength(3);
  });

  it('dla starego wiersza bez okresu pokazuje stawkę bez domyślnego miesiąca', () => {
    renderCard({ salaryMin: 18.75, salaryPeriod: undefined });
    const salaryField = screen.getByText('Salary', { selector: 'dt' }).parentElement!;

    expect(within(salaryField).getByText('from €18.75')).toBeVisible();
    expect(salaryField).not.toHaveTextContent(/month|gross \/ month/i);
  });

  it.each(['pl', 'en', 'nl', 'fr'] as const)('tłumaczy pola i granice stawki: %s', (locale) => {
    renderCard({ salaryMin: 18.75, salaryPeriod: 'hour' }, locale);
    const labels = messages[locale].jobs.passport;
    for (const label of [labels.location, labels.salary, labels.conditions]) {
      expect(screen.getByText(label, { selector: 'dt' })).toBeVisible();
    }
    const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(18.75);
    const field = screen.getByText(labels.salary, { selector: 'dt' }).parentElement!;
    expect(field.querySelector('dd')?.textContent).toBe(`${labels.salaryFrom.replace('{value}', amount)} ${labels.salaryPeriods.hour}`);
    expect(screen.getByText(labels.viewOffer)).toBeVisible();
  });

  it('zachowuje dopasowanie także przy podanej stawce, weryfikację i datę', () => {
    const { container } = renderCard({ salaryMin: 18 }, 'en', 82);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '82');
    expect(screen.getByText('from €18 gross / month')).toBeVisible();
    expect(screen.getByText(en.job.verified)).toBeVisible();
    expect(container.querySelector('time')).toHaveAttribute('datetime', job.publishedAt);
    expect(screen.getByRole('link', { name: job.title })).toHaveAttribute('href', '/oferty-pracy/electrician');
  });

  it('zachowuje odrębny przycisk zapisu i nie powiela regionu', () => {
    renderCard({ region: job.city, companyVerified: false });
    expect(screen.getAllByText('Antwerp')).toHaveLength(1);
    expect(screen.queryByText(en.job.verified)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: en.jobs.saveUnavailable });
    expect(button.closest('a')).toBeNull();
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-pressed');
  });
});
