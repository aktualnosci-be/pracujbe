import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, createTranslator } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
import { useClassifiedsMode as withClassifiedsMode } from '../helpers/portal-mode';
import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';

/**
 * Tryb ogłoszeniowy (#1147; epik #1128) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Statystyki pracodawcy = statystyki ogłoszenia: aktywne oferty, pojawienia w wynikach,
 * wyświetlenia i kliknięcia „Aplikuj u pracodawcy” (`apply_started`). Liczniki procesu
 * (zgłoszenia, dopasowani, rozmowy „do odpowiedzi”, lejek rekrutacyjny, wysłane aplikacje) nie są
 * liczone ani zwracane przez loadery — nie tylko ukryte w UI. Każdy przypadek ma kontrolę ujemną:
 * w trybie `RECRUITMENT` ta sama ścieżka wysyła zapytania o zgłoszenia i rozmowy, więc loader bez
 * bramki byłby czerwony.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', () => ({ getActiveCompany: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const MESSAGES = { pl, nl, fr, en } as const;
type Locale = keyof typeof MESSAGES;

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: Locale; namespace: string }) =>
    createTranslator({ locale, messages: MESSAGES[locale], namespace: namespace as never }),
}));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & {
    href: string | { pathname: string; query: Record<string, string> };
  }) => (
    <a {...props} href={typeof href === 'string' ? href : `${href.pathname}?${new URLSearchParams(href.query)}`}>
      {children}
    </a>
  ),
}));

const { getActiveCompany } = await import('@/lib/company-context');
const employer = await import('@/lib/data/employer');
const { jobFunnelCsv } = await import('@/lib/job-funnel/csv');
const { JobFunnelStats } = await import('@/components/employer/JobFunnelStats');
const { EmployerOverviewStats } = await import('@/components/employer/EmployerOverviewStats');
const { EmployerFunnelSection } = await import('@/components/employer/EmployerFunnelSection');

withClassifiedsMode();

const USER = '11111111-1111-4111-8111-111111111111';
const JOB = '33333333-3333-4333-8333-333333333333';

/** Tabele procesu rekrutacyjnego — w trybie ogłoszeniowym loader statystyk ich nie czyta. */
const PROCESS_TABLES = /public\.(applications|application_status_history|matches|conversations|messages)\b/;

const FUNNEL_ROW = {
  job_id: JOB, title: 'Magazynier', slug: 'magazynier', status: 'active',
  search_appearances: 120, detail_views: 40, apply_started: 7, applications_submitted: 3,
};

function recruitment(): void {
  vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
}

function activeAs(role: string, status = 'verified') {
  vi.mocked(getActiveCompany).mockResolvedValue({
    activeId: 'company-1', activeStatus: status, activeName: 'Firma', activeRole: role, companies: [],
  });
}

function stubAllCounters() {
  fakeDb.count('employer.overview-active-jobs', 2);
  fakeDb.count('employer.overview-new-applications', 5);
  fakeDb.count('employer.overview-matched-candidates', 4);
  fakeDb.count('employer.overview-awaiting-reply', 1);
  fakeDb.count('employer.funnel-applications', 9);
  fakeDb.count('employer.funnel-interviews', 2);
  fakeDb.count('employer.funnel-hired', 1);
  fakeDb.rpc('get_company_job_funnel', [FUNNEL_ROW]);
}

function processCalls() {
  return fakeDb.calls.filter((call) => PROCESS_TABLES.test(call.text)
    || /overview-(new-applications|matched-candidates|awaiting-reply)|funnel-(applications|interviews|hired)/.test(call.name));
}

afterEach(cleanup);

describe('#1147: loadery statystyk w trybie ogłoszeniowym', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetFakeDb({ id: USER, role: 'employer' });
    activeAs('owner');
    stubAllCounters();
  });

  it('przegląd = aktywne oferty + wyświetlenia i kliknięcia z lejka ofert, bez zapytań o proces', async () => {
    await expect(employer.getEmployerOverview()).resolves.toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 2, listingDetailViews: 40, listingApplyClicks: 7,
        recruiterAccess: true, companyVerified: true,
      },
    });
    expect(processCalls()).toEqual([]);
    expect(fakeDb.callsTo('get_company_job_funnel')).toHaveLength(1);
  });

  it('zwykły member (odmowa RPC lejka) → „brak danych”, nie zero', async () => {
    activeAs('member');
    fakeDb.rpc('get_company_job_funnel', () => { throw pgError('42501', 'PERMISSION_DENIED'); });
    const load = await employer.getEmployerOverview();
    expect(load).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 2, listingDetailViews: null, listingApplyClicks: null,
        recruiterAccess: false, companyVerified: true,
      },
    });
    expect(processCalls()).toEqual([]);
  });

  it('lejek rekrutacyjny → disabled bez żadnego zapytania', async () => {
    await expect(employer.getFunnelStats()).resolves.toEqual({ status: 'disabled' });
    expect(fakeDb.calls).toEqual([]);
    expect(getActiveCompany).not.toHaveBeenCalled();
  });

  it('lejek ofert bez pola wysłanych aplikacji (per oferta i w sumie)', async () => {
    const load = await employer.getJobFunnel(30);
    expect(load.status).toBe('ok');
    if (load.status !== 'ok') return;
    expect(load.totals).toEqual({ searchAppearances: 120, detailViews: 40, applyStarted: 7 });
    expect(load.jobs[0]).not.toHaveProperty('applicationsSubmitted');
  });

  it('demo (bez bazy) także bez liczników procesu', async () => {
    resetFakeDb({ id: USER, role: 'employer' });
    const { fakeSession } = await import('../helpers/fake-db');
    fakeSession.configured = false;
    try {
      const overview = await employer.getEmployerOverview();
      expect(overview.status === 'ok' && overview.overview).not.toHaveProperty('newApplicationsCount');
      expect(overview.status === 'ok' && overview.overview).not.toHaveProperty('messagesToAnswerCount');
      await expect(employer.getFunnelStats()).resolves.toEqual({ status: 'disabled' });
      const funnel = await employer.getJobFunnel(30);
      expect(funnel.status === 'ok' && funnel.totals).not.toHaveProperty('applicationsSubmitted');
    } finally {
      fakeSession.configured = true;
    }
  });

  it('kontrola ujemna: tryb RECRUITMENT liczy zgłoszenia, rozmowy i lejek rekrutacyjny', async () => {
    recruitment();
    const overview = await employer.getEmployerOverview();
    expect(overview.status === 'ok' && overview.overview).toMatchObject({
      newApplicationsCount: 5, messagesToAnswerCount: 1,
    });
    expect(overview.status === 'ok' && overview.overview).not.toHaveProperty('listingDetailViews');
    const funnel = await employer.getFunnelStats();
    expect(funnel.status).toBe('ok');
    const jobFunnel = await employer.getJobFunnel(30);
    expect(jobFunnel.status === 'ok' && jobFunnel.totals.applicationsSubmitted).toBe(3);
    expect(fakeDb.callsTo('employer.overview-new-applications')).toHaveLength(1);
    expect(fakeDb.callsTo('employer.overview-awaiting-reply')).toHaveLength(1);
    expect(fakeDb.callsTo('employer.funnel-applications')).toHaveLength(1);
    expect(processCalls().length).toBeGreaterThan(0);
  });
});

describe('#1147: CSV lejka ofert', () => {
  const range = { from: '2026-08-30', to: '2026-09-28' };
  const labels = {
    from: 'Od', to: 'Do', offer: 'Oferta', status: 'Status', searchAppearances: 'S', detailViews: 'D',
    applyStarted: pl.jobFunnel.applyClicks, total: 'Razem', untitled: '?', statusLabel: () => 'Aktywna',
  };

  it('tryb ogłoszeniowy: bez kolumny wysłanych aplikacji', () => {
    const job = { title: 'Magazynier', status: 'active', searchAppearances: 1, detailViews: 2, applyStarted: 3 };
    const csv = jobFunnelCsv(range, [job], job, labels);
    const [header, row] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header!.split(',')).toHaveLength(7);
    expect(header).toContain(pl.jobFunnel.applyClicks);
    expect(header).not.toContain(pl.jobFunnel.applicationsSubmitted);
    expect(row).toBe('2026-08-30,2026-09-28,Magazynier,Aktywna,1,2,3');
  });

  it('kontrola ujemna: tryb rekrutacyjny ma kolumnę wysłanych aplikacji', () => {
    const job = { title: 'Magazynier', status: 'active', searchAppearances: 1, detailViews: 2, applyStarted: 3, applicationsSubmitted: 4 };
    const csv = jobFunnelCsv(range, [job], job, { ...labels, applicationsSubmitted: pl.jobFunnel.applicationsSubmitted });
    const [header] = csv.replace(/^﻿/, '').split('\r\n');
    expect(header!.split(',')).toHaveLength(8);
    expect(header).toContain(pl.jobFunnel.applicationsSubmitted);
  });
});

describe('#1147: widoki statystyk', () => {
  const range = { days: 30 as const, from: '2026-08-30', to: '2026-09-28' };

  it.each(Object.entries(MESSAGES) as [Locale, (typeof MESSAGES)[Locale]][])(
    '%s: lejek ofert = statystyki ogłoszenia (kliknięcia „Aplikuj u pracodawcy”, bez wysłanych aplikacji)',
    (locale, messages) => {
      const totals = { searchAppearances: 120, detailViews: 40, applyStarted: 7 };
      render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <JobFunnelStats range={range} totals={totals} jobs={[]} locale={locale} />
        </NextIntlClientProvider>,
      );
      const t = messages.jobFunnel;
      expect(screen.getAllByText(t.applyClicks).length).toBeGreaterThan(0);
      expect(screen.getByText(t.applyClicksDefinition)).toBeInTheDocument();
      expect(screen.getByTestId('job-funnel-consent-note')).toHaveTextContent(t.consentNoteListing);
      expect(screen.queryByText(t.applicationsSubmitted)).toBeNull();
      expect(screen.queryByText(t.applyStarted)).toBeNull();
      expect(screen.queryByText(t.consentNote)).toBeNull();
    },
  );

  it('kontrola ujemna: dane z wysłanymi aplikacjami → widok rekrutacyjny', () => {
    const totals = { searchAppearances: 120, detailViews: 40, applyStarted: 7, applicationsSubmitted: 3 };
    render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <JobFunnelStats range={range} totals={totals} jobs={[]} locale="pl" />
      </NextIntlClientProvider>,
    );
    expect(screen.getAllByText(pl.jobFunnel.applicationsSubmitted).length).toBeGreaterThan(0);
    expect(screen.queryByText(pl.jobFunnel.applyClicks)).toBeNull();
  });

  it.each(Object.entries(MESSAGES) as [Locale, (typeof MESSAGES)[Locale]][])(
    '%s: kafelki przeglądu bez zgłoszeń, dopasowanych i wiadomości',
    async (locale, messages) => {
      const element = await EmployerOverviewStats({
        locale,
        demo: false,
        overview: {
          status: 'ok',
          overview: { activeOffersCount: 2, listingDetailViews: 40, listingApplyClicks: 7, recruiterAccess: true, companyVerified: true },
        },
      });
      const { container } = render(<NextIntlClientProvider locale={locale} messages={messages}>{element}</NextIntlClientProvider>);
      const text = container.textContent ?? '';
      expect(text).toContain(messages.dashboard.activeOffers);
      expect(text).toContain(messages.jobFunnel.detailViews);
      expect(text).toContain(messages.jobFunnel.applyClicks);
      for (const key of ['newApplications', 'matchedCandidates', 'messagesToAnswer'] as const) {
        expect(text).not.toContain(messages.dashboard[key]);
      }
    },
  );

  it('kafelki: kontrola ujemna — przegląd rekrutacyjny pokazuje zgłoszenia i wiadomości', async () => {
    const element = await EmployerOverviewStats({
      locale: 'pl',
      demo: false,
      overview: {
        status: 'ok',
        overview: { activeOffersCount: 2, newApplicationsCount: 5, messagesToAnswerCount: 1, recruiterAccess: true, companyVerified: true },
      },
    });
    const { container } = render(<NextIntlClientProvider locale="pl" messages={pl}>{element}</NextIntlClientProvider>);
    expect(container.textContent).toContain(pl.dashboard.newApplications);
    expect(container.textContent).not.toContain(pl.jobFunnel.applyClicks);
  });

  it('pulpit: w miejscu lejka rekrutacyjnego tylko odnośnik do statystyk ogłoszeń', async () => {
    const element = await EmployerFunnelSection({ locale: 'pl', funnel: { status: 'disabled' } });
    const { container } = render(<NextIntlClientProvider locale="pl" messages={pl}>{element}</NextIntlClientProvider>);
    expect(screen.getByRole('heading', { level: 2, name: pl.dashboard.listingStatsTitle })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: pl.dashboard.funnelDetails })).toHaveAttribute('href', '/employer/statystyki');
    expect(container.textContent).not.toContain(pl.dashboard.funnelTitle);
    expect(container.textContent).not.toMatch(/\d/);
  });
});
