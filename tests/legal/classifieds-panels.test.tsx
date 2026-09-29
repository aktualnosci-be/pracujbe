import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import * as candidateData from '@/lib/data/candidate';
import * as employerData from '@/lib/data/employer';
// Alias: nazwa `use*` myli regułę react-hooks/rules-of-hooks (to nie hook Reacta, tylko beforeEach/afterEach).
import { withRecruitmentMode as recruitmentModeInTests } from '../helpers/portal-mode';

/**
 * #1141/#1144 — decyzja produktowa: portal ogłoszeniowy. W trybie `CLASSIFIEDS_ONLY` (domyślnym):
 * - nawigacja paneli nie ma pozycji zgłoszeń ani propozycji (shell dostaje tryb z serwera,
 *   brak propsa = fail-closed);
 * - pulpit pracodawcy nie renderuje sekcji najnowszych zgłoszeń (menu statusu, „Zobacz wszystkie”)
 *   i nie woła `getRecentApplications`;
 * - pulpit kandydata nie woła `getMyApplicationsPreview`/`getLatestActiveOffer` i nie pokazuje
 *   baneru propozycji ani podglądu zgłoszeń.
 * Kontrola ujemna: tryb `RECRUITMENT` przywraca każdą z tych rzeczy.
 *
 * Pulpity renderowane w trybie demo (bez bazy) — loadery zwracają dane przykładowe.
 */

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/panel',
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/auth/SessionKeepAlive', () => ({ SessionKeepAlive: () => null }));
vi.mock('@/components/dashboard/DashboardShell', () => ({
  DashboardShell: ({ nav, children }: { nav: { href: string }[]; children: ReactNode }) => (
    <>
      <nav>
        {nav.map((item) => (
          <a key={item.href} href={item.href} data-testid="nav-item">
            {item.href}
          </a>
        ))}
      </nav>
      {children}
    </>
  ),
}));
vi.mock('@/components/employer/CompanySwitcher', () => ({ CompanySwitcher: () => null }));
// Wyspy klienckie i podsekcje innych PR-ów — znaczniki (test sprawdza tylko sekcję zgłoszeń/propozycji).
vi.mock('@/components/employer/ApplicationStatusMenu', () => ({
  ApplicationStatusMenu: () => <span data-testid="status-menu" />,
}));
vi.mock('@/components/employer/SendOfferButton', () => ({ SendOfferButton: () => null }));
// Sekcje matchingu (#1133/#1139, osobny PR) — asynchroniczne komponenty serwerowe; tu znaczniki.
vi.mock('@/components/employer/EmployerTopMatched', () => ({ EmployerTopMatched: () => null }));
vi.mock('@/components/candidate/CandidateRecommendedPreview', () => ({ CandidateRecommendedPreview: () => null }));
// Skrót statystyk ogłoszeń (tryb ogłoszeniowy) — znacznik; treść pokrywa unit `classifieds-employer-stats`.
vi.mock('@/components/employer/EmployerListingStats', () => ({
  EmployerListingStats: ({ top }: { top: { status: string } }) =>
    top.status === 'disabled' ? null : <span data-testid="listing-stats" />,
}));
vi.mock('@/components/employer/EmployerOverviewStats', () => ({ EmployerOverviewStats: () => null }));
vi.mock('@/components/employer/EmployerFunnelSection', () => ({ EmployerFunnelSection: () => null }));
vi.mock('@/components/employer/EmployerOffersPreview', () => ({ EmployerOffersPreview: () => null }));
vi.mock('@/components/employer/CompanyStatusBanner', () => ({ CompanyStatusBanner: () => null }));
vi.mock('@/components/employer/RecruiterOnlyNote', () => ({ RecruiterOnlyNote: () => null }));
vi.mock('@/components/candidate/NewProposalBanner', () => ({
  NewProposalBanner: () => <span data-testid="proposal-banner" />,
}));
vi.mock('@/components/candidate/CandidateApplicationsPreview', () => ({
  CandidateApplicationsPreview: () => <span data-testid="applications-preview" />,
}));
vi.mock('@/components/candidate/CandidateMessagesPreview', () => ({ CandidateMessagesPreview: () => null }));
vi.mock('@/components/candidate/CvUpload', () => ({ CvUpload: () => null }));
vi.mock('@/components/candidate/SaveJobButton', () => ({ SaveJobButton: () => null }));
vi.mock('@/lib/data/employer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/employer')>();
  return { ...actual, getRecentApplications: vi.fn(actual.getRecentApplications) };
});
vi.mock('@/lib/data/candidate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/candidate')>();
  return {
    ...actual,
    getMyApplicationsPreview: vi.fn(actual.getMyApplicationsPreview),
    getLatestActiveOffer: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', status: 'sent' })),
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const params = Promise.resolve({ locale: 'pl' });

async function renderEmployerDashboard() {
  const { default: Page } = await import('@/app/[locale]/employer/page');
  render(await Page({ params }));
}

async function renderCandidateDashboard() {
  const { default: Page } = await import('@/app/[locale]/candidate/page');
  render(await Page({ params }));
}

const navHrefs = () => screen.getAllByTestId('nav-item').map((a) => a.getAttribute('href'));

describe('tryb ogłoszeniowy (domyślny)', () => {
  it('nawigacja kandydata bez zgłoszeń i propozycji (brak propsa = fail-closed)', async () => {
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    render(<CandidateShell>{null}</CandidateShell>);
    expect(navHrefs()).not.toContain('/candidate/aplikacje');
    expect(navHrefs()).not.toContain('/candidate/propozycje');
    expect(navHrefs()).toContain('/candidate/zapisane');
  });

  it('nawigacja pracodawcy bez panelu zgłoszeń', async () => {
    const { EmployerShell } = await import('@/components/employer/EmployerShell');
    render(<EmployerShell>{null}</EmployerShell>);
    expect(navHrefs()).not.toContain('/employer/aplikacje');
    expect(navHrefs()).toContain('/employer/oferty');
  });

  it('pulpit pracodawcy: bez sekcji zgłoszeń, loader niewołany', async () => {
    await renderEmployerDashboard();
    expect(employerData.getRecentApplications).not.toHaveBeenCalled();
    expect(screen.queryByText('recentApplications')).toBeNull();
    expect(screen.queryByTestId('status-menu')).toBeNull();
    expect(document.querySelector('a[href^="/employer/aplikacje"]')).toBeNull();
  });

  it('pulpit kandydata: bez baneru propozycji i podglądu zgłoszeń, loadery niewołane', async () => {
    await renderCandidateDashboard();
    expect(candidateData.getMyApplicationsPreview).not.toHaveBeenCalled();
    expect(candidateData.getLatestActiveOffer).not.toHaveBeenCalled();
    expect(screen.queryByTestId('proposal-banner')).toBeNull();
    expect(screen.queryByTestId('applications-preview')).toBeNull();
    expect(screen.queryByText('activeApplications')).toBeNull();
  });
});

describe('tryb ogłoszeniowy: pulpit pracodawcy zamiast sekcji rekrutacyjnych', () => {
  it('pulpit pracodawcy: skrót statystyk ogłoszeń w miejscu „Top dopasowani”', async () => {
    await renderEmployerDashboard();
    expect(screen.getByTestId('listing-stats')).toBeInTheDocument();
    // Podtytuł bez „rekrutacji”.
    expect(screen.getByText('employerGreetingSubListingGeneric')).toBeInTheDocument();
    expect(screen.queryByText('employerGreetingSubGeneric')).toBeNull();
  });
});

describe('kontrola ujemna: tryb RECRUITMENT', () => {
  recruitmentModeInTests();

  it('shell z recruitmentEnabled pokazuje pozycje zgłoszeń i propozycji', async () => {
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    const { EmployerShell } = await import('@/components/employer/EmployerShell');
    render(
      <>
        <CandidateShell recruitmentEnabled>{null}</CandidateShell>
        <EmployerShell recruitmentEnabled>{null}</EmployerShell>
      </>,
    );
    expect(navHrefs()).toEqual(
      expect.arrayContaining(['/candidate/aplikacje', '/candidate/propozycje', '/employer/aplikacje']),
    );
  });

  it('pulpit pracodawcy: sekcja zgłoszeń z menu statusu', async () => {
    await renderEmployerDashboard();
    expect(employerData.getRecentApplications).toHaveBeenCalledTimes(1);
    expect(screen.getByText('recentApplications')).toBeInTheDocument();
    expect(screen.getAllByTestId('status-menu').length).toBeGreaterThan(0);
  });

  it('pulpit kandydata: baner propozycji i podgląd zgłoszeń', async () => {
    await renderCandidateDashboard();
    expect(candidateData.getMyApplicationsPreview).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('proposal-banner')).toBeInTheDocument();
    expect(screen.getByTestId('applications-preview')).toBeInTheDocument();
  });

  it('pulpit pracodawcy: bez skrótu statystyk ogłoszeń, stary podtytuł', async () => {
    await renderEmployerDashboard();
    expect(screen.queryByTestId('listing-stats')).toBeNull();
    expect(screen.getByText('employerGreetingSubGeneric')).toBeInTheDocument();
  });
});
