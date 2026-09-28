import type { ReactNode } from 'react';
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, resetFakeDb } from '../helpers/fake-db';
import { withClassifiedsMode } from '../helpers/portal-mode';

/**
 * Tryb ogłoszeniowy — profil i onboarding kandydata wyłączone (epik #1128, decyzja produktowa:
 * portal ogłoszeniowy). Profil kandydata służył dopasowaniom i przeglądaniu przez firmy; bez nich
 * nie ma odbiorcy: `/candidate/profil` (z podstronami) i `/candidate/onboarding` dają 404,
 * `saveOnboardingStep` zwraca `RECRUITMENT_DISABLED` przed bazą, pulpit/nawigacja nie odsyłają do
 * profilu. Każdy przypadek ma kontrolę ujemną w trybie `RECRUITMENT`.
 */

const shell = vi.hoisted(() => ({
  props: null as null | {
    nav: { href: string }[];
    user: { name: string; subtitle?: string };
  },
}));

vi.mock('server-only', () => ({}));
vi.mock('next/navigation', () => ({
  notFound: () => {
    throw new Error('NEXT_NOT_FOUND');
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }));
vi.mock('@/i18n/navigation', () => ({
  usePathname: () => '/candidate',
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: vi.fn(),
  Link: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/dashboard/DashboardShell', () => ({
  DashboardShell: (props: NonNullable<typeof shell.props> & { children: ReactNode }) => {
    shell.props = props;
    return <>{props.children}</>;
  },
}));
vi.mock('@/lib/db/portal', async () => {
  const fake = (await import('../helpers/fake-db')).fakePortal();
  return {
    ...fake,
    getPortalIdentity: vi.fn(fake.getPortalIdentity),
    withPortalTransaction: vi.fn(fake.withPortalTransaction),
  };
});
vi.mock('@/lib/auth/current', () => ({ getCurrentIdentity: async () => null }));
vi.mock('@/lib/env', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/env')>()),
  isPortalAuthConfigured: () => false,
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('react', async (importOriginal) => ({ ...(await importOriginal<typeof import('react')>()), cache: (fn: unknown) => fn }));

const portal = await import('@/lib/db/portal');
const { saveOnboardingStep } = await import('@/lib/actions/onboarding');
const { getCandidateOverview, getCandidateProfileSummary } = await import('@/lib/data/candidate');
const { CandidateShell } = await import('@/components/candidate/CandidateShell');
const { default: ProfileLayout } = await import('@/app/[locale]/candidate/profil/layout');
const { default: OnboardingLayout } = await import('@/app/[locale]/candidate/onboarding/layout');

const USER = '11111111-1111-4111-8111-111111111111';
const STEP1 = { firstName: 'Anna', lastName: 'Kowalska', phone: '' };

const recruitment = () => vi.stubEnv('PORTAL_LEGAL_MODE', 'RECRUITMENT');

withClassifiedsMode();

beforeEach(() => {
  vi.clearAllMocks();
  shell.props = null;
  resetFakeDb({ id: USER, role: 'candidate' });
});
afterEach(cleanup);

describe('trasy profilu i onboardingu', () => {
  it('tryb ogłoszeniowy: /candidate/profil (layout segmentu) = 404', () => {
    expect(() => ProfileLayout({ children: null })).toThrow('NEXT_NOT_FOUND');
  });

  it('tryb ogłoszeniowy: /candidate/onboarding = 404', async () => {
    await expect(OnboardingLayout({ children: null, params: Promise.resolve({ locale: 'pl' }) })).rejects.toThrow(
      'NEXT_NOT_FOUND',
    );
  });

  it('kontrola ujemna: tryb RECRUITMENT renderuje oba segmenty', async () => {
    recruitment();
    expect(() => ProfileLayout({ children: null })).not.toThrow();
    await expect(
      OnboardingLayout({ children: null, params: Promise.resolve({ locale: 'pl' }) }),
    ).resolves.toBeTruthy();
  });
});

describe('saveOnboardingStep', () => {
  it('tryb ogłoszeniowy: RECRUITMENT_DISABLED przed walidacją, tożsamością i bazą', async () => {
    for (const step of [1, 2, 3, 4, 5, 6] as const) {
      await expect(saveOnboardingStep(step, STEP1)).resolves.toEqual({ ok: false, error: 'RECRUITMENT_DISABLED' });
    }
    await expect(saveOnboardingStep(6, {}, { finish: true })).resolves.toEqual({
      ok: false,
      error: 'RECRUITMENT_DISABLED',
    });
    expect(portal.getPortalIdentity).not.toHaveBeenCalled();
    expect(portal.withPortalTransaction).not.toHaveBeenCalled();
    expect(fakeDb.calls).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT zapisuje krok 1 w transakcji sesji', async () => {
    recruitment();
    fakeDb.exec('onboarding.step1-profile', 1);
    await expect(saveOnboardingStep(1, STEP1)).resolves.toMatchObject({ ok: true });
    expect(fakeDb.callsTo('onboarding.step1-profile')).toHaveLength(1);
  });
});

describe('pulpit: bez kompletności profilu', () => {
  beforeEach(() => {
    fakeDb
      .rows('candidate.profile-name', [{ first_name: 'Anna', last_name: 'Kowalska' }])
      .rows('candidate.profile-completeness', [{ id: 'cp-1', experience_years: 3, occupations: ['x'], categories: [] }])
      .rpc('get_public_jobs_count', 12)
      .count('candidate.active-applications', 0)
      .count('candidate.unread-conversations', 0);
  });

  it('tryb ogłoszeniowy: imię do powitania, ale bez zapytania o profil kandydata i bez wyniku', async () => {
    await expect(getCandidateProfileSummary()).resolves.toMatchObject({
      loadFailed: false,
      firstName: 'Anna',
      completionPct: 0,
    });
    await expect(getCandidateOverview()).resolves.toMatchObject({ profileCompletionPct: 0 });
    expect(fakeDb.callsTo('candidate.profile-completeness')).toEqual([]);
  });

  it('kontrola ujemna: tryb RECRUITMENT czyta kompletność profilu', async () => {
    recruitment();
    const summary = await getCandidateProfileSummary();
    expect(summary.completionPct).toBeGreaterThan(0);
    expect(fakeDb.callsTo('candidate.profile-completeness')).toHaveLength(1);
  });
});

describe('nawigacja panelu kandydata', () => {
  it('tryb ogłoszeniowy (domyślny prop): bez pozycji „Profil” i bez podpisu „Zobacz profil”', () => {
    render(<CandidateShell userName="Anna">x</CandidateShell>);
    expect(shell.props?.nav.map((i) => i.href)).not.toContain('/candidate/profil');
    expect(shell.props?.nav.map((i) => i.href)).toContain('/candidate/ustawienia');
    expect(shell.props?.user.subtitle).toBeUndefined();
  });

  it('kontrola ujemna: recruitmentEnabled pokazuje pozycję „Profil” i podpis', () => {
    render(
      <CandidateShell userName="Anna" recruitmentEnabled>
        x
      </CandidateShell>,
    );
    expect(shell.props?.nav.map((i) => i.href)).toContain('/candidate/profil');
    expect(shell.props?.user.subtitle).toBe('viewProfile');
  });
});
