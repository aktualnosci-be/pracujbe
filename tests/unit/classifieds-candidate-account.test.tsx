import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as candidateData from '@/lib/data/candidate';
import * as candidateFiles from '@/lib/data/candidate-files';
import * as savedSearchJobs from '@/lib/data/candidate-saved-search-jobs';
import { CLASSIFIEDS_CANDIDATE_NAV, candidateNavKeys } from '@/lib/candidate-nav';
import { withClassifiedsMode, withRecruitmentMode } from '../helpers/portal-mode';

/**
 * #1142 — decyzja produktowa: portal ogłoszeniowy. Konto kandydata bez profilu zawodowego:
 * nawigacja = pulpit, zapisane oferty, zapisane wyszukiwania, ustawienia; pulpit bez
 * kompletności/MatchBar/podglądów zgłoszeń, propozycji, wiadomości i CV (loadery niewołane);
 * kreator onboardingu odrzucony przed bazą. Kontrola ujemna: tryb `RECRUITMENT` = pełny panel.
 */

const path = vi.hoisted(() => ({ current: '/candidate' }));
vi.mock('server-only', () => ({}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key, useLocale: () => 'pl' }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  setRequestLocale: () => undefined,
  getLocale: async () => 'pl',
}));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => path.current,
  useRouter: () => ({ refresh: vi.fn() }),
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/auth/SessionKeepAlive', () => ({ SessionKeepAlive: () => null }));
vi.mock('@/components/dashboard/DashboardShell', () => ({
  DashboardShell: ({ nav, children }: { nav: { href: string }[]; children: ReactNode }) => (
    <>
      <nav data-testid="shell">
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
// Sekcje pulpitu pełnego — znaczniki (test sprawdza, czy w ogóle są renderowane).
vi.mock('@/components/candidate/ProfileCompleteness', () => ({ ProfileCompleteness: () => <span data-testid="completeness" /> }));
vi.mock('@/components/candidate/CvUpload', () => ({ CvUpload: () => <span data-testid="cv-upload" /> }));
vi.mock('@/components/candidate/CandidateMessagesPreview', () => ({
  CandidateMessagesPreview: () => <span data-testid="messages-preview" />,
}));
vi.mock('@/components/candidate/CandidateRecommendedPreview', () => ({ CandidateRecommendedPreview: () => null }));
vi.mock('@/components/candidate/SaveJobButton', () => ({ SaveJobButton: () => null }));
// Oferty z zapisanych wyszukiwań: asynchroniczny komponent serwerowy — znacznik (treść: unit
// `classifieds-candidate-saved-search-jobs`); loader owinięty, żeby sprawdzić wywołanie.
vi.mock('@/components/candidate/CandidateSavedSearchJobs', () => ({
  CandidateSavedSearchJobs: ({ result }: { result: unknown }) =>
    result === null ? null : <span data-testid="saved-search-jobs" />,
}));
vi.mock('@/lib/data/candidate-saved-search-jobs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/candidate-saved-search-jobs')>();
  return { ...actual, loadSavedSearchJobs: vi.fn(actual.loadSavedSearchJobs) };
});
vi.mock('@/lib/data/candidate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/candidate')>();
  return {
    ...actual,
    getCandidateProfileSummary: vi.fn(actual.getCandidateProfileSummary),
    getCandidateOverview: vi.fn(actual.getCandidateOverview),
    getLatestMessages: vi.fn(actual.getLatestMessages),
    getCandidateAccountOverview: vi.fn(actual.getCandidateAccountOverview),
  };
});
vi.mock('@/lib/data/candidate-files', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/data/candidate-files')>();
  return { ...actual, loadCandidateFiles: vi.fn(actual.loadCandidateFiles) };
});

const ROOT = join(__dirname, '..', '..');
const navHrefs = () => screen.queryAllByTestId('nav-item').map((a) => a.getAttribute('href'));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  path.current = '/candidate';
});

describe('nawigacja kandydata: jedno źródło listy', () => {
  it('tryb ogłoszeniowy = dokładnie pulpit, zapisane oferty, zapisane wyszukiwania, ustawienia', () => {
    expect([...candidateNavKeys(false)]).toEqual(['summary', 'saved', 'searches', 'settings']);
  });

  it('kontrola ujemna: lista z „Wiadomościami” nie przechodzi asercji', () => {
    expect([...CLASSIFIEDS_CANDIDATE_NAV, 'messages']).not.toEqual(['summary', 'saved', 'searches', 'settings']);
    expect(candidateNavKeys(true)).toContain('messages');
  });

  it('CandidateShell bez propsa (fail-closed): 4 pozycje, bez profilu i wiadomości', async () => {
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    render(<CandidateShell>{null}</CandidateShell>);
    expect(navHrefs()).toEqual(['/candidate', '/candidate/zapisane', '/candidate/wyszukiwania', '/candidate/ustawienia']);
  });

  it('CandidateShell: ścieżka kreatora w trybie ogłoszeniowym renderuje się w panelu (404 z nawigacją)', async () => {
    path.current = '/candidate/onboarding';
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    render(<CandidateShell>{null}</CandidateShell>);
    expect(screen.getByTestId('shell')).toBeTruthy();
  });

  it('kontrola ujemna: recruitmentEnabled = pełny panel, kreator bez sidebara', async () => {
    const { CandidateShell } = await import('@/components/candidate/CandidateShell');
    render(<CandidateShell recruitmentEnabled>{null}</CandidateShell>);
    expect(navHrefs()).toEqual(expect.arrayContaining(['/candidate/wiadomosci', '/candidate/profil']));
    cleanup();
    path.current = '/candidate/onboarding';
    render(<CandidateShell recruitmentEnabled>{null}</CandidateShell>);
    expect(screen.queryByTestId('shell')).toBeNull();
  });
});

describe('pulpit kandydata w trybie ogłoszeniowym', () => {
  withClassifiedsMode();

  it('bez kompletności, CV i podglądu wiadomości; loadery profilu/CV/wiadomości niewołane', async () => {
    const { default: Page } = await import('@/app/[locale]/candidate/page');
    const { CandidateAccountDashboard } = await import('@/components/candidate/CandidateAccountDashboard');
    const element = await Page({ params: Promise.resolve({ locale: 'pl' }) });
    // Strona oddaje pulpit konta (komponent asynchroniczny renderujemy sami — RTL nie obsługuje async RSC).
    expect(element.type).toBe(CandidateAccountDashboard);
    render(await CandidateAccountDashboard({ locale: 'pl' }));
    expect(screen.getByTestId('candidate-account-dashboard')).toBeTruthy();
    expect(screen.queryByTestId('completeness')).toBeNull();
    expect(screen.queryByTestId('cv-upload')).toBeNull();
    expect(screen.queryByTestId('messages-preview')).toBeNull();
    expect(screen.queryByText('profileCompleteness')).toBeNull();
    expect(screen.getAllByText('navSaved').length).toBeGreaterThan(0);
    expect(screen.getAllByText('navSearches').length).toBeGreaterThan(0);
    expect(candidateData.getCandidateProfileSummary).not.toHaveBeenCalled();
    expect(candidateData.getCandidateOverview).not.toHaveBeenCalled();
    expect(candidateData.getLatestMessages).not.toHaveBeenCalled();
    expect(candidateFiles.loadCandidateFiles).not.toHaveBeenCalled();
    expect(candidateData.getCandidateAccountOverview).toHaveBeenCalled();
    // Oferty z zapisanych wyszukiwań: w miejscu polecanych, na już odczytanej liście wyszukiwań.
    expect(screen.getByTestId('saved-search-jobs')).toBeTruthy();
    expect(savedSearchJobs.loadSavedSearchJobs).toHaveBeenCalledTimes(1);
    expect(vi.mocked(savedSearchJobs.loadSavedSearchJobs).mock.calls[0]![0]).toMatchObject({ status: 'ready' });
  });
});

describe('kontrola ujemna: pulpit w trybie RECRUITMENT', () => {
  withRecruitmentMode();

  it('czyta profil, CV i wiadomości i pokazuje kompletność', async () => {
    const { default: Page } = await import('@/app/[locale]/candidate/page');
    render(await Page({ params: Promise.resolve({ locale: 'pl' }) }));
    expect(screen.getByTestId('completeness')).toBeTruthy();
    expect(candidateData.getCandidateProfileSummary).toHaveBeenCalled();
    expect(candidateFiles.loadCandidateFiles).toHaveBeenCalled();
    // Oferty z zapisanych wyszukiwań to tylko pulpit konta trybu ogłoszeniowego.
    expect(savedSearchJobs.loadSavedSearchJobs).not.toHaveBeenCalled();
    expect(screen.queryByTestId('saved-search-jobs')).toBeNull();
  });
});

describe('kreator onboardingu odrzucony przed bazą', () => {
  const step1 = { firstName: 'Anna', lastName: 'Nowak', phone: '' };

  describe('tryb ogłoszeniowy', () => {
    withClassifiedsMode();
    beforeEach(() => vi.resetModules());

    it.each([1, 2, 3, 4, 5, 6] as const)('krok %s → RECRUITMENT_DISABLED', async (step) => {
      const { saveOnboardingStep } = await import('@/lib/actions/onboarding');
      expect(await saveOnboardingStep(step, step === 1 ? step1 : {}, { finish: step === 6 })).toEqual({
        ok: false,
        error: 'RECRUITMENT_DISABLED',
      });
    });
  });

  describe('kontrola ujemna: tryb RECRUITMENT', () => {
    withRecruitmentMode();

    it('krok 1 (demo bez bazy) przechodzi', async () => {
      const { saveOnboardingStep } = await import('@/lib/actions/onboarding');
      expect(await saveOnboardingStep(1, step1)).toEqual({ ok: true, demo: true });
    });
  });
});

/**
 * Linki do kreatora i profilu zawodowego: dozwolone tylko w plikach renderowanych wyłącznie
 * w trybie RECRUITMENT (trasy 404 w trybie ogłoszeniowym albo sekcje ukryte w tym trybie).
 */
const WIZARD_LINK = /["'`]\/candidate\/(onboarding|profil)\b/;
const CLASSIFIEDS_ACCOUNT_FILES = [
  'src/components/candidate/CandidateAccountDashboard.tsx',
  'src/components/candidate/CandidateNotFound.tsx',
  'src/app/[locale]/candidate/ustawienia/page.tsx',
  'src/app/[locale]/candidate/zapisane/page.tsx',
  'src/app/[locale]/candidate/wyszukiwania/page.tsx',
  'src/app/[locale]/candidate/powiadomienia/page.tsx',
  'src/components/settings/NotificationPreferencesForm.tsx',
  'src/components/settings/AccountDataSettings.tsx',
  'src/components/settings/CompanyBlocksSettings.tsx',
  'src/components/settings/AgeAttestationSettings.tsx',
];

describe('brak linków do kreatora w panelu konta (tryb ogłoszeniowy)', () => {
  it.each(CLASSIFIEDS_ACCOUNT_FILES)('%s', (file) => {
    expect(readFileSync(join(ROOT, file), 'utf8')).not.toMatch(WIZARD_LINK);
  });

  it('kontrola ujemna: link do kreatora jest wykrywany', () => {
    expect('<Link href="/candidate/onboarding?step=3">').toMatch(WIZARD_LINK);
    expect("href={'/candidate/profil'}").toMatch(WIZARD_LINK);
  });
});
