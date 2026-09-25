import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
  getLocale: async () => 'pl',
  setRequestLocale: () => undefined,
}));
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'user-agent': 'vitest', 'x-real-ip': '203.0.113.7' }),
  cookies: async () => ({ get: () => undefined }),
}));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
// Limiter i Turnstile mają własne testy (inne grupy #25); tu przepuszczamy.
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: async () => true }));
vi.mock('@/lib/turnstile/verify', () => ({ enforceTurnstile: async () => null }));
const linkToken: { confirm: string | null; claim: string | null } = { confirm: null, claim: null };
vi.mock('@/lib/guest-apply/link-cookie', () => ({
  readGuestLinkToken: async (purpose: 'confirm' | 'claim') => linkToken[purpose],
  clearGuestLinkToken: async () => undefined,
}));
// Guardy layoutów (#24): tożsamość z `getCurrentIdentity`, nazwa z prawdziwego odczytu profilu.
vi.mock('@/lib/auth/current', async (orig) => (await import('./support/real-portal')).realCurrent(await orig()));
vi.mock('@/lib/db/runtime', async (orig) => (await import('./support/real-portal')).realDomainRuntime(await orig()));
vi.mock('@/lib/env', async (orig) => ({ ...(await orig<typeof import('@/lib/env')>()), isPortalAuthConfigured: () => true }));
// Chrome panelu (inne grupy): layout testujemy tylko w zakresie guardu i nazwy użytkownika.
vi.mock('@/lib/data/notifications', () => ({ getNotifications: async () => ({ status: 'ready', items: [], unread: 0 }) }));
vi.mock('@/lib/data/messages', () => ({ getUnreadConversationsCount: async () => 0 }));
vi.mock('@/components/candidate/CandidateShell', () => ({ CandidateShell: () => null }));
vi.mock('@/components/candidate/OnboardingWizard', () => ({ OnboardingWizard: () => null }));
vi.mock('@/components/candidate/OnboardingLoadError', () => ({ OnboardingLoadError: () => null }));
vi.mock('@/components/public/GuestClaimPanel', () => ({ GuestClaimPanel: () => null }));
vi.mock('@/components/public/GuestLinkIntake', () => ({ GuestLinkIntake: () => null }));
vi.mock('@/components/ui/card', () => ({ Card: () => null, CardContent: () => null, CardHeader: () => null, CardTitle: () => null }));
vi.mock('@/i18n/navigation', () => ({
  redirect: ({ href }: { href: string }) => { throw new Error(`REDIRECT:${href}`); },
  Link: () => null,
}));

const candidateData = await import('../../src/lib/data/candidate');
const { getMyJobMatch } = await import('../../src/lib/data/matching');
const { toggleSavedJob, withdrawApplication } = await import('../../src/lib/actions/candidate');
const { applyToJob, transitionApplication } = await import('../../src/lib/actions/applications');
const { sendOffer, respondToOffer } = await import('../../src/lib/actions/offers');
const { getPublicSavedJobs } = await import('../../src/lib/actions/public-saved-jobs');
const { saveOnboardingStep } = await import('../../src/lib/actions/onboarding');
const guest = await import('../../src/lib/actions/guest-applications');
const { guestTokenFromNonce } = await import('../../src/lib/guest-apply/token');
// Integracja kompiluje TSX klasycznym transformem JSX (React.createElement).
(globalThis as { React?: unknown }).React = await import('react');
const { default: CandidateLayout } = await import('../../src/app/[locale]/candidate/layout');
const { default: OnboardingPage } = await import('../../src/app/[locale]/candidate/onboarding/page');
const { default: OnboardingLayout } = await import('../../src/app/[locale]/candidate/onboarding/layout');
const { default: GuestClaimPage } = await import('../../src/app/[locale]/(auth)/aplikacja/przejmij/page');

// #25: rdzeń panelu kandydata na PostgreSQL 16 — RLS sesji, RPC przepływów, stronicowanie.
let alice: string;
let bob: string;
let employer: string;
let stranger: string;
let companyId: string;
const jobIds: string[] = [];

function db() {
  return realSession.db!;
}

async function makeJob(index: number, company: string, slug = `job-${index}-${randomUUID().slice(0, 8)}`) {
  const { rows } = await db().admin.query(
    `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at)
     VALUES ($1, $2, $3, 'active', 'warehouse', 'permanent', 'Gent', 'Flandria', now() - ($4 || ' minutes')::interval)
     RETURNING id`,
    [company, slug, `Oferta ${index}`, String(index)],
  );
  const id = rows[0].id as string;
  await db().admin.query(`INSERT INTO public.job_translations(job_id, locale, title) VALUES ($1, 'pl', $2)`, [id, `Oferta ${index}`]);
  return id;
}

async function completeOnboarding(as: string) {
  actAs({ id: as, role: 'candidate' });
  expect(await saveOnboardingStep(1, { firstName: 'Alicja', lastName: 'Nowak', phone: '' })).toEqual({ ok: true });
  expect(await saveOnboardingStep(2, { occupations: ['Magazynier'], categories: ['warehouse'] })).toEqual({ ok: true });
  expect(await saveOnboardingStep(3, { experienceYears: 3, skills: ['Wózek widłowy', 'Kompletacja'] })).toEqual({ ok: true });
  expect(await saveOnboardingStep(4, {
    city: 'Gent', region: 'Flandria', radiusKm: 30, hasDrivingLicense: true, hasCar: false,
  })).toEqual({ ok: true });
  expect(await saveOnboardingStep(5, {
    languages: [{ language: 'Polski', level: 'native' }, { language: 'Niderlandzki', level: 'intermediate' }],
    certificates: ['VCA'],
    certificateExpiry: { VCA: '2030-01-31' },
  })).toEqual({ ok: true });
  return saveOnboardingStep(6, {
    availability: 'immediate', preferredContractTypes: ['permanent'], agreeTerms: true, privacyNoticeAck: true,
  }, { finish: true });
}

beforeAll(async () => {
  const pg = await startPortalDb();
  realSession.db = pg;
  alice = await pg.createUser('candidate');
  bob = await pg.createUser('candidate');
  employer = await pg.createUser('employer');
  stranger = await pg.createUser('employer');
  await pg.admin.query('UPDATE auth.users SET email_verified = true WHERE id = ANY($1::uuid[])', [[alice, bob]]);
  const { rows } = await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma A', 'verified') RETURNING id`);
  companyId = rows[0].id;
  const other = await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma B', 'verified') RETURNING id`);
  await pg.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active)
    VALUES ($1, $2, 'owner', true), ($3, $4, 'owner', true)`, [companyId, employer, other.rows[0].id, stranger]);
  for (let i = 0; i < 12; i++) jobIds.push(await makeJob(i, companyId));
});

afterAll(async () => { await realSession.db?.stop(); });

describe('onboarding i profil kandydata (#25)', () => {
  it('kroki 1–6 zapisują się pod sesją, finish_onboarding i receipt (service_role) działają', async () => {
    expect(await completeOnboarding(alice)).toEqual({ ok: true });
    const { rows } = await db().admin.query(
      `SELECT cp.profile_completed, cp.city, cp.categories::text[] AS categories,
              (SELECT count(*)::int FROM public.candidate_skills s WHERE s.candidate_profile_id = cp.id) AS skills,
              (SELECT array_agg(d.document || ':' || d.kind || ':' || d.source ORDER BY d.document)::text[]
                 FROM public.document_acceptances d WHERE d.profile_id = cp.profile_id) AS docs
         FROM public.candidate_profiles cp WHERE cp.profile_id = $1`, [alice]);
    // #493: regulamin i informacja o prywatności jako osobne receipty kanału onboarding.
    expect(rows[0]).toMatchObject({
      profile_completed: true, city: 'Gent', categories: ['warehouse'], skills: 2,
      docs: ['privacy:privacy_notice_ack:onboarding', 'terms:terms_acceptance:onboarding'],
    });
  });

  it('niekompletny profil: „Zakończ” zwraca ONBOARDING_INCOMPLETE, a dane kroku 6 zostają', async () => {
    actAs({ id: bob, role: 'candidate' });
    expect(await saveOnboardingStep(6, {
      availability: 'within_month', preferredContractTypes: ['temporary'], agreeTerms: true, privacyNoticeAck: true,
    }, { finish: true })).toEqual({ ok: false, error: 'ONBOARDING_INCOMPLETE' });
    const { rows } = await db().admin.query('SELECT availability::text FROM public.candidate_profiles WHERE profile_id = $1', [bob]);
    expect(rows[0]?.availability).toBe('within_month');
  });

  it('podsumowanie, paszport i kreator czytają wyłącznie własny profil', async () => {
    actAs({ id: alice, role: 'candidate' });
    const summary = await candidateData.getCandidateProfileSummary();
    expect(summary).toMatchObject({ loadFailed: false, firstName: 'Alicja', completionPct: 100 });
    const passport = await candidateData.getCandidatePassport();
    expect(passport).toMatchObject({
      loadFailed: false, occupations: ['Magazynier'], city: 'Gent', radiusKm: 30, experienceYears: 3,
      availability: 'immediate', certificates: ['VCA'],
    });
    expect([...passport.skills].sort()).toEqual(['Kompletacja', 'Wózek widłowy']);
    expect([...passport.languages].sort()).toEqual(['Niderlandzki', 'Polski']);

    const page = await OnboardingPage({ params: Promise.resolve({ locale: 'pl' }), searchParams: Promise.resolve({}) });
    const values = (page as { props: { initialValues?: Record<string, unknown> } }).props.initialValues;
    expect(values).toMatchObject({
      firstName: 'Alicja', city: 'Gent', certificates: ['VCA'], certificateExpiry: { VCA: '2030-01-31' },
    });
    expect((values?.['skills'] as string[]).sort()).toEqual(['Kompletacja', 'Wózek widłowy']);

    actAs({ id: bob, role: 'candidate' });
    const bobPassport = await candidateData.getCandidatePassport();
    expect(bobPassport).toMatchObject({ loadFailed: false, skills: [], certificates: [], availability: 'within_month' });
    expect((await candidateData.getCandidateProfileSummary()).firstName).not.toBe('Alicja');
  });

  it('layout: gość → logowanie, pracodawca → /employer, kandydat widzi własne imię', async () => {
    const params = Promise.resolve({ locale: 'pl' });
    actAs(null);
    await expect(CandidateLayout({ children: null, params })).rejects.toThrow('REDIRECT:/logowanie');
    actAs({ id: employer, role: 'employer' });
    await expect(CandidateLayout({ children: null, params })).rejects.toThrow('REDIRECT:/employer');
    actAs({ id: alice, role: 'candidate' });
    const el = await CandidateLayout({ children: null, params }) as { props: { userName?: string } };
    expect(el.props.userName).toBe('Alicja Nowak');
    actAs(null);
    await expect(OnboardingLayout({ children: null, params })).rejects.toThrow('REDIRECT:/logowanie');
  });

  it('strona przejęcia aplikacji gościa rozpoznaje sesję', async () => {
    linkToken.claim = 'x'.repeat(43);
    const signedIn = async () => {
      const page = await GuestClaimPage({ params: Promise.resolve({ locale: 'pl' }) });
      // Card → CardContent → GuestLinkIntake → GuestClaimPanel
      const content = (page as { props: { children: { props: { children: unknown } }[] } }).props.children[1]!;
      const intake = content.props.children as { props: { children: { props: { signedIn: boolean } } } };
      return intake.props.children.props.signedIn;
    };
    actAs(null);
    expect(await signedIn()).toBe(false);
    actAs({ id: bob, role: 'candidate' });
    expect(await signedIn()).toBe(true);
    linkToken.claim = null;
  });
});

describe('aplikacje, propozycje i zapisane oferty (#25)', () => {
  let aliceApp: string;

  it('apply_to_job idempotentnie; inny klucz = APPLICATION_ALREADY_EXISTS; gość = UNAUTHENTICATED', async () => {
    actAs({ id: alice, role: 'candidate' });
    const key = randomUUID();
    const first = await applyToJob({ jobId: jobIds[0]!, idempotencyKey: key, message: 'Dzień dobry', agreeTerms: true });
    expect(first.ok).toBe(true);
    const retry = await applyToJob({ jobId: jobIds[0]!, idempotencyKey: key, message: 'Dzień dobry', agreeTerms: true });
    expect(retry).toEqual(first);
    expect(await applyToJob({ jobId: jobIds[0]!, idempotencyKey: randomUUID(), agreeTerms: true }))
      .toEqual({ ok: false, error: 'APPLICATION_ALREADY_EXISTS' });
    if (first.ok) aliceApp = first.id;
    actAs(null);
    expect(await applyToJob({ jobId: jobIds[1]!, idempotencyKey: randomUUID(), agreeTerms: true })).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    actAs({ id: employer, role: 'employer' });
    expect(await applyToJob({ jobId: jobIds[1]!, idempotencyKey: randomUUID(), agreeTerms: true })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('historia zgłoszeń: stronicowanie kursorem przy równym czasie, bez cudzych zgłoszeń', async () => {
    const at = '2026-09-20T09:00:00.123456+00:00';
    for (const jobId of jobIds.slice(1)) {
      await db().admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status, submitted_at, idempotency_key)
        VALUES ($1, $2, $3, 'submitted', $4, $5)`, [jobId, alice, companyId, at, randomUUID()]);
    }
    await db().admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status, submitted_at, idempotency_key)
      VALUES ($1, $2, $3, 'submitted', now(), $4)`, [jobIds[5], bob, companyId, randomUUID()]);

    actAs({ id: alice, role: 'candidate' });
    const first = await candidateData.getMyApplicationsPage('pl');
    expect(first.items).toHaveLength(10);
    expect(first.items[0]).toMatchObject({ id: aliceApp, jobTitle: 'Oferta 0', companyName: 'Firma A' });
    expect(first.nextCursor?.submittedAt).toBe(at);
    const second = await candidateData.getMyApplicationsPage('pl', first.nextCursor);
    expect(second.items).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.items, ...second.items].map((item) => item.id);
    expect(new Set(ids).size).toBe(12);

    actAs({ id: bob, role: 'candidate' });
    const bobPage = await candidateData.getMyApplicationsPage('pl');
    expect(bobPage.items).toHaveLength(1);
    expect(bobPage.items.map((i) => i.id)).not.toContain(aliceApp);
  });

  it('pulpit: liczniki z bazy dla właściciela sesji', async () => {
    actAs({ id: alice, role: 'candidate' });
    const overview = await candidateData.getCandidateOverview();
    expect(overview).toEqual({ newJobsCount: 12, activeApplicationsCount: 12, unreadMessagesCount: 0, profileCompletionPct: 100 });
    actAs({ id: bob, role: 'candidate' });
    expect((await candidateData.getCandidateOverview()).activeApplicationsCount).toBe(1);
  });

  it('zmiana statusu: tylko pracodawca firmy oferty; wycofanie tylko własnej aplikacji', async () => {
    actAs({ id: stranger, role: 'employer' });
    expect((await transitionApplication(aliceApp, 'viewed')).ok).toBe(false);
    actAs({ id: employer, role: 'employer' });
    expect(await transitionApplication(aliceApp, 'viewed')).toEqual({ ok: true });
    const bobApp = await db().admin.query('SELECT id FROM public.applications WHERE candidate_id = $1', [bob]);
    expect(await transitionApplication(bobApp.rows[0].id, 'rejected')).toEqual({ ok: true });
    expect(await transitionApplication(bobApp.rows[0].id, 'shortlisted')).toEqual({ ok: false, error: 'INVALID_TRANSITION' });

    const { rows } = await db().admin.query(`SELECT id FROM public.applications WHERE candidate_id = $1 AND job_id = $2`, [alice, jobIds[11]]);
    actAs({ id: bob, role: 'candidate' });
    expect((await withdrawApplication(rows[0].id)).ok).toBe(false);
    actAs({ id: alice, role: 'candidate' });
    expect(await withdrawApplication(rows[0].id)).toEqual({ ok: true });
    expect(await withdrawApplication(rows[0].id)).toEqual({ ok: true });
    const status = await db().admin.query('SELECT status::text FROM public.applications WHERE id = $1', [rows[0].id]);
    expect(status.rows[0].status).toBe('withdrawn');
  });

  it('propozycja: send_offer idempotentny, historia i najnowsza aktywna tylko dla adresata', async () => {
    actAs({ id: employer, role: 'employer' });
    const key = randomUUID();
    const sent = await sendOffer({ jobId: jobIds[0]!, candidateId: alice, idempotencyKey: key });
    expect(sent.ok).toBe(true);
    expect(await sendOffer({ jobId: jobIds[0]!, candidateId: alice, idempotencyKey: key })).toEqual(sent);
    if (!sent.ok) return;

    actAs({ id: alice, role: 'candidate' });
    const page = await candidateData.getMyOffersPage('pl');
    expect(page.items).toEqual([expect.objectContaining({ id: sent.id, jobTitle: 'Oferta 0', companyName: 'Firma A', status: 'sent' })]);
    expect(await candidateData.getLatestActiveOffer('pl')).toMatchObject({ id: sent.id, jobTitle: 'Oferta 0' });

    actAs({ id: bob, role: 'candidate' });
    expect((await candidateData.getMyOffersPage('pl')).items).toEqual([]);
    expect(await candidateData.getLatestActiveOffer('pl')).toBeNull();
    expect((await respondToOffer(sent.id, true)).ok).toBe(false);

    actAs({ id: alice, role: 'candidate' });
    expect(await respondToOffer(sent.id, true)).toEqual({ ok: true });
    expect(await candidateData.getLatestActiveOffer('pl')).toBeNull();
    expect((await candidateData.getMyOffersPage('pl')).items[0]?.status).toBe('accepted');
  });

  it('zapisane oferty: idempotentny zapis, odczyt tylko własnych, stan partii dla gościa', async () => {
    actAs({ id: alice, role: 'candidate' });
    expect(await toggleSavedJob(jobIds[2]!, true)).toEqual({ ok: true, saved: true });
    expect(await toggleSavedJob(jobIds[2]!, true)).toEqual({ ok: true, saved: true });
    expect(await toggleSavedJob(jobIds[3]!)).toEqual({ ok: true, saved: true });
    expect(await toggleSavedJob(jobIds[3]!)).toEqual({ ok: true, saved: false });
    expect(await toggleSavedJob(jobIds[3]!, false)).toEqual({ ok: true, saved: false });
    const saved = await candidateData.getSavedJobs('pl');
    expect(saved).toEqual({ status: 'ready', jobs: [expect.objectContaining({ id: jobIds[2], title: 'Oferta 2', saved: true })] });
    expect(await getPublicSavedJobs([jobIds[2]!, jobIds[3]!])).toEqual({ status: 'candidate', savedIds: [jobIds[2]] });

    actAs({ id: bob, role: 'candidate' });
    expect(await candidateData.getSavedJobs('pl')).toEqual({ status: 'ready', jobs: [] });
    expect(await getPublicSavedJobs([jobIds[2]!])).toEqual({ status: 'candidate', savedIds: [] });
    actAs(null);
    expect(await getPublicSavedJobs([jobIds[2]!])).toEqual({ status: 'anonymous' });
    expect(await toggleSavedJob(jobIds[2]!, true)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs({ id: employer, role: 'employer' });
    expect(await getPublicSavedJobs([jobIds[2]!])).toEqual({ status: 'unavailable' });
  });

  it('polecane: najlepsze własne dopasowania, fallback najnowszych bez procentu', async () => {
    await db().admin.query(`INSERT INTO public.matches(candidate_id, job_id, score) VALUES ($1, $2, 91), ($1, $3, 77), ($4, $5, 99)`,
      [alice, jobIds[7], jobIds[4], bob, jobIds[9]]);
    actAs({ id: alice, role: 'candidate' });
    const recommended = await candidateData.getRecommendedJobs('pl', true);
    expect(recommended.map((r) => [r.id, r.match])).toEqual([[jobIds[7], 91], [jobIds[4], 77]]);
    actAs({ id: stranger, role: 'employer' });
    const fallback = await candidateData.getRecommendedJobs('pl', true);
    expect(fallback).toHaveLength(5);
    expect(fallback.every((r) => r.match === null)).toBe(true);
  });

  it('dopasowanie do oferty liczone z własnego profilu; bez profilu = none', async () => {
    actAs({ id: alice, role: 'candidate' });
    const match = await getMyJobMatch(jobIds[0]!);
    expect(match.status).toBe('ok');
    actAs({ id: employer, role: 'employer' });
    expect(await getMyJobMatch(jobIds[0]!)).toEqual({ status: 'none' });
    actAs({ id: alice, role: 'candidate' });
    expect(await getMyJobMatch(randomUUID())).toEqual({ status: 'none' });
  });

  it('ostatnie wiadomości i licznik nieprzeczytanych rozmów tylko dla członka', async () => {
    const { rows } = await db().admin.query(`INSERT INTO public.conversations(company_id, subject, last_message_at)
      VALUES ($1, 'Rozmowa', now()) RETURNING id`, [companyId]);
    const conv = rows[0].id;
    await db().admin.query(`INSERT INTO public.conversation_members(conversation_id, profile_id) VALUES ($1, $2), ($1, $3)`, [conv, alice, employer]);
    await db().admin.query(`INSERT INTO public.messages(conversation_id, sender_id, body, created_at)
      VALUES ($1, $2, 'Pierwsza', now() - interval '1 minute'), ($1, $3, 'Najnowsza', now())`, [conv, alice, employer]);

    actAs({ id: alice, role: 'candidate' });
    expect(await candidateData.getLatestMessages()).toEqual({
      status: 'ok', items: [expect.objectContaining({ id: conv, title: 'Rozmowa', preview: 'Najnowsza', unread: true })],
    });
    expect((await candidateData.getCandidateOverview()).unreadMessagesCount).toBe(1);
    await db().admin.query('UPDATE public.conversation_members SET last_read_at = now() + interval \'1 second\' WHERE profile_id = $1', [alice]);
    expect((await candidateData.getCandidateOverview()).unreadMessagesCount).toBe(0);

    actAs({ id: bob, role: 'candidate' });
    expect(await candidateData.getLatestMessages()).toEqual({ status: 'ok', items: [] });
  });
});

describe('aplikacja bez konta (#98, #25)', () => {
  it('submit (service_role) → confirm → claim tylko przez właściciela adresu', async () => {
    const email = `${bob}@example.invalid`;
    actAs(null);
    const input = {
      jobId: jobIds[6]!, fullName: 'Bob Gość', email, phone: '', phoneCountry: 'BE', message: '',
      locale: 'pl', idempotencyKey: randomUUID(), agreeTerms: true,
    };
    expect(await guest.submitGuestApplication(input as never)).toEqual({ ok: true });
    expect(await guest.submitGuestApplication(input as never)).toEqual({ ok: true });
    const request = await db().admin.query('SELECT confirm_nonce FROM public.guest_application_requests WHERE email = $1', [email]);
    expect(request.rows).toHaveLength(1);
    linkToken.confirm = guestTokenFromNonce('confirm', request.rows[0].confirm_nonce);
    expect(await guest.confirmGuestApplication('pl')).toMatchObject({ ok: true, outcome: 'confirmed' });

    const claim = await db().admin.query('SELECT claim_nonce FROM public.guest_application_requests WHERE email = $1', [email]);
    linkToken.claim = guestTokenFromNonce('claim', claim.rows[0].claim_nonce);
    actAs(null);
    expect(await guest.claimGuestApplication('pl')).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    actAs({ id: alice, role: 'candidate' });
    expect((await guest.claimGuestApplication('pl')).ok).toBe(false);
    actAs({ id: bob, role: 'candidate' });
    const claimed = await guest.claimGuestApplication('pl');
    expect(claimed.ok).toBe(true);
    if (claimed.ok) {
      const { rows } = await db().admin.query('SELECT candidate_id FROM public.applications WHERE id = $1', [claimed.applicationId]);
      expect(rows[0].candidate_id).toBe(bob);
    }
  });
});
