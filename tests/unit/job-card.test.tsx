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

const intl = vi.hoisted(() => ({ locale: 'en' }));
vi.mock('next-intl/server', async () => {
  const { createFormatter, createTranslator } = await import('next-intl');
  const all = {
    pl: (await import('@/messages/pl.json')).default,
    en: (await import('@/messages/en.json')).default,
    nl: (await import('@/messages/nl.json')).default,
    fr: (await import('@/messages/fr.json')).default,
  };
  const current = () => intl.locale as keyof typeof all;
  return {
    getLocale: async () => current(),
    getTranslations: async (namespace: string) =>
      createTranslator({ locale: current(), messages: all[current()], namespace: namespace as never }),
    getFormatter: async () => createFormatter({ locale: current(), timeZone: 'Europe/Brussels' }),
  };
});

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

async function renderCard(overrides: Partial<JobListItem> = {}, locale: keyof typeof messages = 'en', matchScore?: number) {
  intl.locale = locale;
  // Komponent serwerowy (async): renderujemy zwrócony element jak RSC.
  const card = await JobCard({ job: { ...job, ...overrides }, showMatch: matchScore !== undefined, matchScore });
  return render(
    <NextIntlClientProvider locale={locale} messages={messages[locale]} timeZone="Europe/Brussels">
      {card}
    </NextIntlClientProvider>,
  );
}

describe('Paszport oferty', () => {
  it('bez stawki pomija całe pole i zachowuje miejsce oraz warunki', async () => {
    const { container } = await renderCard();
    expect([...container.querySelectorAll('dt')].map((el) => el.textContent)).toEqual(['Location', 'Conditions']);
    expect(screen.getByText('Antwerp')).toBeVisible();
    expect(screen.getByText('Flanders')).toBeVisible();
    expect(screen.getByText(en.contractTypes.permanent)).toBeVisible();
    expect(screen.getByText('Transport')).toBeVisible();
    expect(screen.queryByText(en.job.salaryNotProvided)).not.toBeInTheDocument();
  });

  it.each([
    [{ salaryMin: 18.75, salaryMax: 22.5, salaryPeriod: 'hour' as const }, '€18.75 – €22.50 gross / hour'],
    [{ salaryMin: 18.75, salaryPeriod: 'month' as const }, 'from €18.75 gross / month'],
    [{ salaryMax: 22.5, salaryPeriod: 'year' as const }, 'up to €22.50 gross / year'],
    [{ salaryMin: 0, salaryPeriod: 'hour' as const }, 'from €0 gross / hour'],
  ])('pokazuje podane granice i okres: %j', async (salary, expected) => {
    const { container } = await renderCard(salary);
    const salaryField = screen.getByText('Salary', { selector: 'dt' }).parentElement!;
    // Kwota i okres (w <small> pod kwotą, jak `.passport-data small` w prototypie) = jeden zapis.
    expect(salaryField.querySelector('dd')).toHaveTextContent(expected);
    expect(salaryField.querySelector('dd')).toBeVisible();
    expect(container.querySelectorAll('dt')).toHaveLength(3);
  });

  it('dla starego wiersza bez okresu pokazuje stawkę bez domyślnego miesiąca', async () => {
    await renderCard({ salaryMin: 18.75, salaryPeriod: undefined });
    const salaryField = screen.getByText('Salary', { selector: 'dt' }).parentElement!;

    expect(within(salaryField).getByText('from €18.75')).toBeVisible();
    expect(salaryField).not.toHaveTextContent(/month|gross \/ month/i);
  });

  it.each(['pl', 'en', 'nl', 'fr'] as const)('tłumaczy pola i granice stawki: %s', async (locale) => {
    await renderCard({ salaryMin: 18.75, salaryPeriod: 'hour' }, locale);
    const labels = messages[locale].jobs.passport;
    for (const label of [labels.location, labels.salary, labels.conditions]) {
      expect(screen.getByText(label, { selector: 'dt' })).toBeVisible();
    }
    const amount = new Intl.NumberFormat(locale, { style: 'currency', currency: 'EUR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(18.75);
    const field = screen.getByText(labels.salary, { selector: 'dt' }).parentElement!;
    expect(field.querySelector('dd')?.textContent).toBe(`${labels.salaryFrom.replace('{value}', amount)} ${labels.salaryPeriods.hour}`);
    expect(screen.getByText(labels.viewOffer)).toBeVisible();
  });

  it('zachowuje dopasowanie także przy podanej stawce, weryfikację i datę', async () => {
    const { container } = await renderCard({ salaryMin: 18 }, 'en', 82);
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '82');
    expect(screen.getByText('Salary', { selector: 'dt' }).parentElement!.querySelector('dd')).toHaveTextContent('from €18 gross / month');
    expect(screen.getByText(en.job.verified)).toBeVisible();
    expect(container.querySelector('time')).toHaveAttribute('datetime', job.publishedAt);
    expect(screen.getByRole('link', { name: job.title })).toHaveAttribute('href', '/oferty-pracy/electrician');
  });

  // #391: data liczona na serwerze po dniu kalendarzowym w Brukseli (zgodna z ISR).
  it('względna data: ten sam dzień w Brukseli = „today”, pełna data w title', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-24T11:45:00Z'));
    try {
      const { container } = await renderCard({ publishedAt: '2026-09-23T22:30:00Z' });
      const time = container.querySelector('time');
      expect(time).toHaveTextContent('today');
      expect(time).toHaveAttribute('title', 'September 24, 2026');
    } finally {
      vi.useRealTimers();
    }
  });

  it('zachowuje odrębny przycisk zapisu i nie powiela regionu', async () => {
    await renderCard({ region: job.city, companyVerified: false });
    expect(screen.getAllByText('Antwerp')).toHaveLength(1);
    expect(screen.queryByText(en.job.verified)).not.toBeInTheDocument();
    const button = screen.getByRole('button', { name: en.jobs.saveUnavailable });
    expect(button.closest('a')).toBeNull();
    expect(button).toBeDisabled();
    expect(button).not.toHaveAttribute('aria-pressed');
  });

  // #297: fikcyjna oferta demo jest oznaczona i nie ma odznaki weryfikacji firmy.
  it.each(Object.entries(messages))('oferta demo: etykieta „przykładowa”, bez odznaki weryfikacji (%s)', async (locale, m) => {
    await renderCard({ isDemo: true, companyVerified: true }, locale as keyof typeof messages);
    expect(screen.getByText(m.jobs.demoBadge)).toBeVisible();
    expect(screen.queryByText(m.job.verified)).not.toBeInTheDocument();
  });

  it('kontrola ujemna: oferta z bazy (bez isDemo) zachowuje odznakę i nie ma etykiety demo', async () => {
    await renderCard({ companyVerified: true });
    expect(screen.getByText(en.job.verified)).toBeVisible();
    expect(screen.queryByText(en.jobs.demoBadge)).not.toBeInTheDocument();
  });
});
