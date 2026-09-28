// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob, bulkTransitionApplications, transitionApplication } from '@/lib/actions/applications';
import { withdrawApplication } from '@/lib/actions/candidate';
import {
  loadApplicationScreeningAnswers,
  loadMoreApplications,
  loadMoreMyApplicationHistory,
} from '@/lib/actions/candidate-applications';
import { loadMoreProposals } from '@/lib/actions/candidate-proposals';
import { loadMoreApplicationHistory } from '@/lib/actions/employer-application-history';
import {
  claimGuestApplication,
  confirmGuestApplication,
  submitGuestApplication,
} from '@/lib/actions/guest-applications';
import { stageGuestLink } from '@/lib/actions/guest-link';
import { respondToOffer, sendOffer } from '@/lib/actions/offers';
import {
  getMyApplicationHistoryPage,
  getMyApplicationScreeningAnswers,
  getMyApplicationsPage,
  getMyOffersPage,
} from '@/lib/data/candidate';
import { getEmployerApplicationHistoryPage } from '@/lib/data/employer';
import { resolveHref } from '@/lib/data/notifications';
import { readGuestLinkToken, setGuestLinkToken } from '@/lib/guest-apply/link-cookie';
import { checkRateLimit } from '@/lib/rate-limit';
import { enforceTurnstile } from '@/lib/turnstile/verify';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
// Alias: nazwa `use*` myli regułę react-hooks/rules-of-hooks (to nie hook Reacta, tylko beforeEach/afterEach).
import { useRecruitmentMode as recruitmentModeInTests } from '../helpers/portal-mode';

/**
 * #1141 (propozycje), #1144 (zgłoszenia i statusy), #1132 (aplikacja bez konta), część akcji
 * #1130 (`applyToJob`) — decyzja produktowa: portal ogłoszeniowy.
 *
 * W trybie `CLASSIFIEDS_ONLY` (domyślnym, brak zmiennej) każda akcja zwraca `RECRUITMENT_DISABLED`
 * PRZED limiterem, Turnstile, loaderem i bazą: atrapa bazy nie widzi ani jednego zapytania.
 * Kontrola ujemna: te same wywołania w trybie `RECRUITMENT` docierają do bazy / loadera.
 */

const UUID = '11111111-1111-4111-8111-111111111111';
const UUID2 = '22222222-2222-4222-8222-222222222222';
const CURSOR_CREATED = { createdAt: '2026-09-20T09:00:00+00:00', id: UUID2 };
const CURSOR_SUBMITTED = { submittedAt: '2026-09-20T09:00:00+00:00', id: UUID2 };
const GUEST_TOKEN = 'a'.repeat(43);

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => new Headers({ 'x-real-ip': '203.0.113.9', 'user-agent': 'UA' })),
  cookies: vi.fn(async () => ({ get: () => undefined, set: () => undefined, delete: () => undefined })),
}));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: vi.fn(async () => null) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/guest-apply/link-cookie', () => ({
  readGuestLinkToken: vi.fn(async () => null),
  clearGuestLinkToken: vi.fn(async () => undefined),
  setGuestLinkToken: vi.fn(async () => true),
}));
vi.mock('@/lib/data/candidate', () => ({
  getMyOffersPage: vi.fn(async () => ({ items: [], nextCursor: null })),
  getMyApplicationsPage: vi.fn(async () => ({ items: [], nextCursor: null })),
  getMyApplicationHistoryPage: vi.fn(async () => ({ items: [], nextCursor: null })),
  getMyApplicationScreeningAnswers: vi.fn(async () => []),
}));
vi.mock('@/lib/data/employer', () => ({
  getEmployerApplicationHistoryPage: vi.fn(async () => ({ status: 'ok', page: { items: [], nextCursor: null } })),
}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());

const guestInput = {
  jobId: UUID,
  fullName: 'Anna Nowak',
  email: 'anna@example.com',
  locale: 'nl' as const,
  agreeTerms: true as const,
  ageConfirmed: true as const,
  minAge: 18,
  idempotencyKey: UUID2,
};

/** Każda akcja z oczekiwanym wynikiem w trybie ogłoszeniowym. */
const ACTIONS: { name: string; call: () => Promise<unknown>; disabled: unknown }[] = [
  { name: 'sendOffer', call: () => sendOffer({ jobId: UUID, candidateId: UUID2, idempotencyKey: UUID2 }), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'respondToOffer', call: () => respondToOffer(UUID, true), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'loadMoreProposals', call: () => loadMoreProposals('pl', CURSOR_CREATED), disabled: { status: 'error', error: 'RECRUITMENT_DISABLED' } },
  { name: 'applyToJob', call: () => applyToJob({ jobId: UUID, idempotencyKey: UUID2, agreeTerms: true }), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'transitionApplication', call: () => transitionApplication(UUID, 'viewed'), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'bulkTransitionApplications', call: () => bulkTransitionApplications([UUID], 'rejected', UUID2), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'withdrawApplication', call: () => withdrawApplication(UUID), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'loadMoreApplications', call: () => loadMoreApplications('pl', CURSOR_SUBMITTED), disabled: { status: 'error', error: 'RECRUITMENT_DISABLED' } },
  { name: 'loadMoreMyApplicationHistory', call: () => loadMoreMyApplicationHistory(UUID, CURSOR_CREATED), disabled: { status: 'error', error: 'RECRUITMENT_DISABLED' } },
  { name: 'loadApplicationScreeningAnswers', call: () => loadApplicationScreeningAnswers(UUID), disabled: { status: 'error', error: 'RECRUITMENT_DISABLED' } },
  { name: 'loadMoreApplicationHistory', call: () => loadMoreApplicationHistory(UUID, CURSOR_CREATED), disabled: { status: 'error', error: 'RECRUITMENT_DISABLED' } },
  { name: 'submitGuestApplication', call: () => submitGuestApplication(guestInput, 'bot'), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'confirmGuestApplication', call: () => confirmGuestApplication('pl'), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'claimGuestApplication', call: () => claimGuestApplication('pl'), disabled: { ok: false, error: 'RECRUITMENT_DISABLED' } },
  { name: 'stageGuestLink', call: () => stageGuestLink('pl', 'confirm', GUEST_TOKEN), disabled: false },
];

const loaders = () => [
  getMyOffersPage,
  getMyApplicationsPage,
  getMyApplicationHistoryPage,
  getMyApplicationScreeningAnswers,
  getEmployerApplicationHistoryPage,
];

beforeEach(() => {
  vi.clearAllMocks();
  process.env.GUEST_APPLY_SECRET = 's'.repeat(40);
  resetFakeDb({ id: UUID2, role: 'candidate' });
  for (const name of ['send_offer', 'respond_to_offer', 'apply_to_job', 'transition_application', 'withdraw_application', 'submit_guest_application', 'claim_guest_application']) {
    fakeDb.rpc(name, UUID);
  }
  fakeDb.rpc('confirm_guest_application', [{ outcome: 'confirmed', job_slug: 'x' }]);
});

describe('tryb ogłoszeniowy: akcje rekrutacyjne → RECRUITMENT_DISABLED przed bazą', () => {
  it.each(ACTIONS)('$name', async ({ call, disabled }) => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(GUEST_TOKEN);
    expect(await call()).toEqual(disabled);
    expect(fakeDb.calls).toEqual([]);
    for (const loader of loaders()) expect(loader).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
    expect(enforceTurnstile).not.toHaveBeenCalled();
    expect(readGuestLinkToken).not.toHaveBeenCalled();
    expect(setGuestLinkToken).not.toHaveBeenCalled();
  });

  it('powiadomienia o zgłoszeniach i propozycjach prowadzą do pulpitu (panele dają 404)', () => {
    expect(resolveHref('offer', 'candidate')).toBe('/candidate');
    expect(resolveHref('application', 'candidate')).toBe('/candidate');
    expect(resolveHref('job_terms', 'candidate')).toBe('/candidate');
    expect(resolveHref('offer', 'employer')).toBe('/employer');
    expect(resolveHref('application', 'employer')).toBe('/employer');
    expect(resolveHref('job_terms', 'employer')).toBe('/employer/oferty');
  });
});

describe('kontrola ujemna: tryb RECRUITMENT woła bazę / loader', () => {
  recruitmentModeInTests();

  it.each(ACTIONS)('$name nie zwraca RECRUITMENT_DISABLED i dociera dalej', async ({ name, call }) => {
    vi.mocked(readGuestLinkToken).mockResolvedValue(GUEST_TOKEN);
    const result = await call();
    expect(JSON.stringify(result)).not.toContain('RECRUITMENT_DISABLED');
    const reached =
      fakeDb.calls.length > 0 ||
      loaders().some((loader) => vi.mocked(loader).mock.calls.length > 0) ||
      vi.mocked(setGuestLinkToken).mock.calls.length > 0;
    expect(reached, name).toBe(true);
  });

  it('powiadomienia linkują do paneli zgłoszeń i propozycji', () => {
    expect(resolveHref('offer', 'candidate')).toBe('/candidate/propozycje');
    expect(resolveHref('application', 'candidate')).toBe('/candidate/aplikacje');
    expect(resolveHref('job_terms', 'candidate')).toBe('/candidate/aplikacje');
    expect(resolveHref('application', 'employer')).toBe('/employer/aplikacje');
  });
});
