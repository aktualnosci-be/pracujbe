import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PortalIdentity } from '../../src/lib/auth/session';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb, type PortalDb } from './support/portal-db';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
// Aktywna firma bez cookie = pierwsze aktywne członkostwo (company-context waliduje cookie).
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

const employer = await import('../../src/lib/data/employer');
const { getBilling } = await import('../../src/lib/data/billing');
const { jobCityAssist } = await import('../../src/lib/actions/job-location');

// #25: loadery panelu pracodawcy pod RLS na PostgreSQL 16 — izolacja firm, rola member,
// stronicowanie, liczniki, szczegół zgłoszenia i kreator.
let pg: PortalDb;
const ids = {
  companyA: randomUUID(), companyB: randomUUID(),
  jobA: randomUUID(), jobADraft: randomUUID(), jobAClosed: randomUUID(), jobAExpired: randomUUID(),
  jobB: randomUUID(),
};
let ownerA: PortalIdentity;
let memberA: PortalIdentity;
let ownerB: PortalIdentity;
const candidates: string[] = [];
const appsA: string[] = [];
let appB: string;

async function job(id: string, company: string, status: string, slug: string, extra: { expiresAt?: string; createdAt?: string } = {}) {
  await pg.admin.query(
    `INSERT INTO public.jobs(id, company_id, slug, title, status, category, contract_type, city, region,
       published_at, expires_at, created_at)
     VALUES ($1, $2, $3, $4, $5::public.job_status, 'warehouse', 'permanent', 'Antwerp', 'Flandria',
       CASE WHEN $5::text = 'draft' THEN NULL ELSE now() END, $6, coalesce($7::timestamptz, now()))`,
    [id, company, slug, `Oferta ${slug}`, status, extra.expiresAt ?? null, extra.createdAt ?? null]);
}

beforeAll(async () => {
  pg = await startPortalDb();
  realSession.db = pg;
  const employerIds = [await pg.createUser('employer'), await pg.createUser('employer'), await pg.createUser('employer')];
  ownerA = { id: employerIds[0]!, role: 'employer' };
  memberA = { id: employerIds[1]!, role: 'employer' };
  ownerB = { id: employerIds[2]!, role: 'employer' };
  await pg.admin.query(`UPDATE public.profiles SET first_name = 'Olga', last_name = 'Właścicielka' WHERE id = $1`, [ownerA.id]);

  await pg.admin.query(`INSERT INTO public.companies(id, name, status) VALUES ($1, 'Firma A', 'verified'), ($2, 'Firma B', 'verified')`,
    [ids.companyA, ids.companyB]);
  await pg.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active)
    VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true), ($4, $5, 'owner', true)`,
    [ids.companyA, ownerA.id, memberA.id, ids.companyB, ownerB.id]);

  await job(ids.jobA, ids.companyA, 'active', 'a-active', { createdAt: '2026-09-01T10:00:00Z' });
  await job(ids.jobADraft, ids.companyA, 'draft', 'draft-a', { createdAt: '2026-09-02T10:00:00Z' });
  await job(ids.jobAClosed, ids.companyA, 'closed', 'a-closed', { createdAt: '2026-09-03T10:00:00Z' });
  await job(ids.jobAExpired, ids.companyA, 'active', 'a-expired', { createdAt: '2026-09-04T10:00:00Z', expiresAt: '2026-01-01T00:00:00Z' });
  // 10 kolejnych szkiców: razem 14 ofert firmy A (strona 12 + druga strona).
  for (let i = 0; i < 10; i++) {
    await job(randomUUID(), ids.companyA, 'draft', `draft-a-${i}`, { createdAt: `2026-08-${String(10 + i).padStart(2, '0')}T10:00:00Z` });
  }
  await job(ids.jobB, ids.companyB, 'active', 'b-active');

  await pg.admin.query(`INSERT INTO public.job_translations(job_id, locale, title, description, responsibilities)
    VALUES ($1, 'pl', 'Szkic', 'Opis szkicu', ARRAY['Obsługa wózka'])`, [ids.jobADraft]);
  await pg.admin.query(`INSERT INTO public.job_requirements(job_id, locale, kind, position, content)
    VALUES ($1, 'pl', 'mandatory', 1, 'Drugie'), ($1, 'pl', 'mandatory', 0, 'Pierwsze'), ($1, 'pl', 'optional', 0, 'Mile widziane')`,
    [ids.jobADraft]);
  await pg.admin.query(`INSERT INTO public.job_skills(job_id, skill_label, is_mandatory) VALUES ($1, 'Wózek', true), ($1, 'Excel', false)`,
    [ids.jobADraft]);

  for (let i = 0; i < 14; i++) candidates.push(await pg.createUser('candidate'));
  await pg.admin.query(`UPDATE public.profiles SET first_name = 'Kand', last_name = 'Nr' || array_position($1::uuid[], id)
    WHERE id = ANY($1::uuid[])`, [candidates]);
  for (let i = 0; i < 13; i++) {
    const { rows } = await pg.admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status, message, submitted_at)
      VALUES ($1, $2, $3, 'submitted', $4, now() - ($5 || ' minutes')::interval) RETURNING id`,
      [ids.jobA, candidates[i], ids.companyA, `Wiadomość ${i}`, i]);
    appsA.push(rows[0].id);
  }
  appB = (await pg.admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status)
    VALUES ($1, $2, $3, 'submitted') RETURNING id`, [ids.jobB, candidates[13], ids.companyB])).rows[0].id;
  await pg.admin.query(`INSERT INTO public.application_status_history(application_id, from_status, to_status)
    VALUES ($1, 'submitted', 'interview')`, [appsA[0]]);

  await pg.admin.query(`INSERT INTO public.candidate_profiles(profile_id, headline, city, experience_years)
    VALUES ($1, 'Operator wózka', 'Gent', 4), ($2, 'Kierowca', 'Liège', 2)`, [candidates[0], candidates[13]]);
  const cp = (await pg.admin.query('SELECT id FROM public.candidate_profiles WHERE profile_id = $1', [candidates[0]])).rows[0].id;
  await pg.admin.query(`INSERT INTO public.candidate_skills(candidate_profile_id, skill_label) VALUES ($1, 'Wózek widłowy')`, [cp]);
  // Ten sam kandydat dopasowany do dwóch ofert firmy A = jeden „dopasowany kandydat” (P1-14).
  await pg.admin.query(`INSERT INTO public.matches(candidate_id, job_id, score) VALUES ($1, $2, 91), ($1, $5, 50), ($3, $4, 77)`,
    [candidates[0], ids.jobA, candidates[13], ids.jobB, ids.jobAClosed]);

  // Nieprzeczytane powiadomienia o wiadomościach NIE są licznikiem „do odpowiedzi” (P1-14):
  // gdyby były, owner A miałby 3.
  await pg.admin.query(`INSERT INTO public.notifications(profile_id, type, entity_type) VALUES ($1, 'message_received', 'conversation'),
    ($1, 'message_received', 'conversation'), ($1, 'message_received', 'conversation'),
    ($2, 'message_received', 'conversation')`, [ownerA.id, ownerB.id]);

  // Rozmowy: A1 czeka na odpowiedź (ostatnia od kandydata), A2 — odpisał owner, A3 — odpisał
  // member (strona firmowa), A4 — ostatnia wiadomość kandydata usunięta, B — czeka, ale w firmie B.
  async function conversation(company: string, candidate: string, messages: Array<[string, number, boolean?]>) {
    const conv = (await pg.admin.query(`INSERT INTO public.conversations(company_id, created_by) VALUES ($1, $2) RETURNING id`,
      [company, candidate])).rows[0].id;
    // Uczestnicy jak w `start_conversation` (0016): kandydat + aktywni członkowie firmy.
    await pg.admin.query(`INSERT INTO public.conversation_members(conversation_id, profile_id)
      SELECT $1::uuid, $2::uuid UNION SELECT $1::uuid, cm.profile_id FROM public.company_members cm WHERE cm.company_id = $3 AND cm.is_active`,
      [conv, candidate, company]);
    for (const [sender, minutesAgo, deleted] of messages) {
      await pg.admin.query(`INSERT INTO public.messages(conversation_id, sender_id, body, created_at, deleted_at)
        VALUES ($1, $2, 'Treść', now() - ($3 || ' minutes')::interval, CASE WHEN $4 THEN now() END)`,
        [conv, sender, minutesAgo, deleted ?? false]);
    }
  }
  await conversation(ids.companyA, candidates[0]!, [[candidates[0]!, 5]]);
  await conversation(ids.companyA, candidates[1]!, [[candidates[1]!, 10], [ownerA.id, 5]]);
  await conversation(ids.companyA, candidates[2]!, [[candidates[2]!, 10], [memberA.id, 5]]);
  await conversation(ids.companyA, candidates[3]!, [[ownerA.id, 10], [candidates[3]!, 5, true]]);
  await conversation(ids.companyB, candidates[13]!, [[candidates[13]!, 5]]);

  const sub = (await pg.admin.query(`INSERT INTO public.subscriptions(company_id, plan, status) VALUES ($1, 'standard', 'active') RETURNING id`,
    [ids.companyA])).rows[0].id;
  await pg.admin.query(`INSERT INTO public.invoices(company_id, subscription_id, number, status, amount_cents, issued_at)
    VALUES ($1, $2, 'PB-1', 'paid', 9900, now())`, [ids.companyA, sub]);
});

afterAll(async () => { await realSession.db?.stop(); });

describe('panel pracodawcy na PostgreSQL (#25)', () => {
  it('zgłoszenia: stronicowanie po 12 w kolejności submitted_at, tylko firma A', async () => {
    actAs(ownerA);
    const first = await employer.getEmployerApplicationsPage(1);
    const second = await employer.getEmployerApplicationsPage(2);
    expect(first).toMatchObject({ status: 'ok', hasMore: true, isDemo: false });
    expect(second).toMatchObject({ status: 'ok', hasMore: false });
    if (first.status !== 'ok' || second.status !== 'ok') return;
    expect([...first.applications, ...second.applications].map((a) => a.id)).toEqual(appsA);
    expect(first.applications[0]).toMatchObject({ candidateName: 'Kand Nr1', jobTitle: 'Oferta a-active', status: 'submitted' });

    actAs(ownerB);
    const b = await employer.getEmployerApplicationsPage(1);
    expect(b.status === 'ok' && b.applications.map((a) => a.id)).toEqual([appB]);
  });

  it('najnowsze zgłoszenia: najwyżej 6, bez cudzych', async () => {
    actAs(ownerA);
    const recent = await employer.getRecentApplications();
    expect(recent.status === 'ok' && recent.applications.map((a) => a.id)).toEqual(appsA.slice(0, 6));
  });

  it('zwykły member nie widzi zgłoszeń (recruiter+), ale widzi oferty firmy', async () => {
    actAs(memberA);
    expect(await employer.getEmployerApplicationsPage(1)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: false });
    expect(await employer.getRecentApplications()).toEqual({ status: 'ok', applications: [] });
    const jobs = await employer.getCompanyJobsLoad(1);
    expect(jobs.status === 'ok' && jobs.jobs.length).toBe(12);
    // P1-14: liczniki zgłoszeń/dopasowań przy ofertach = „brak danych”, nie zero z RLS.
    expect(jobs.status === 'ok' && jobs.jobs.find((j) => j.id === ids.jobA)).toMatchObject({ newApplications: null, matched: null });
    expect(await employer.getEmployerApplicationDetail(appsA[0]!)).toEqual({ status: 'not_found' });
    // Lejek ofert i lejek rekrutacyjny tylko dla rekrutera: jawna odmowa ≠ błąd ≠ puste zera.
    expect((await employer.getJobFunnel(30)).status).toBe('denied');
    expect(await employer.getFunnelStats()).toEqual({ status: 'denied' });
    expect(await employer.getTopMatchedCandidatesLoad()).toEqual({ status: 'denied' });
    expect(await employer.getEmployerOverview()).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 1, newApplicationsCount: null, matchedCandidatesCount: null, messagesToAnswerCount: null,
        recruiterAccess: false, companyVerified: true,
      },
    });
  });

  it('kafelki (P1-14): aktywne bez przeterminowanych (#72), nowe zgłoszenia, DISTINCT dopasowani, rozmowy firmy do odpowiedzi', async () => {
    actAs(ownerA);
    expect(await employer.getEmployerOverview()).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 1, newApplicationsCount: 13, matchedCandidatesCount: 1, messagesToAnswerCount: 1,
        recruiterAccess: true, companyVerified: true,
      },
    });
    // Kontrola ujemna (cudza firma): dane firmy A nie wchodzą do liczników firmy B i odwrotnie.
    actAs(ownerB);
    expect(await employer.getEmployerOverview()).toEqual({
      status: 'ok',
      overview: {
        activeOffersCount: 1, newApplicationsCount: 1, matchedCandidatesCount: 1, messagesToAnswerCount: 1,
        recruiterAccess: true, companyVerified: true,
      },
    });
  });

  it('kafelki (P1-14): firma niezweryfikowana — dopasowani czekają na weryfikację, reszta realna', async () => {
    await pg.admin.query(`UPDATE public.companies SET status = 'pending' WHERE id = $1`, [ids.companyB]);
    try {
      actAs(ownerB);
      expect(await employer.getEmployerOverview()).toMatchObject({
        status: 'ok',
        overview: { newApplicationsCount: 1, matchedCandidatesCount: null, messagesToAnswerCount: 1, companyVerified: false },
      });
      expect(await employer.getTopMatchedCandidatesLoad()).toEqual({ status: 'unverified' });
    } finally {
      await pg.admin.query(`UPDATE public.companies SET status = 'verified' WHERE id = $1`, [ids.companyB]);
    }
  });

  it('oferty: strony po 12 z licznikami z bazy, status efektywny, bez ofert firmy B', async () => {
    actAs(ownerA);
    const first = await employer.getCompanyJobsLoad(1);
    const second = await employer.getCompanyJobsLoad(2);
    if (first.status !== 'ok' || second.status !== 'ok') throw new Error('expected ok');
    expect(first.hasNext).toBe(true);
    expect(second).toMatchObject({ hasNext: false });
    const all = [...first.jobs, ...second.jobs];
    expect(all).toHaveLength(14);
    expect(all.map((j) => j.id)).not.toContain(ids.jobB);
    expect(all.slice(0, 4).map((j) => j.id)).toEqual([ids.jobAExpired, ids.jobAClosed, ids.jobADraft, ids.jobA]);
    expect(all[0]).toMatchObject({ status: 'expired', pastExpiry: true });
    expect(all.find((j) => j.id === ids.jobA)).toMatchObject({ newApplications: 13, matched: 1, slug: 'a-active' });
  });

  it('top dopasowani: najlepsze dopasowanie firmy z tytułem oferty, bez kandydatów firmy B', async () => {
    actAs(ownerA);
    const top = await employer.getTopMatchedCandidates({ throwOnError: true });
    expect(top).toEqual([{
      candidateId: candidates[0], jobId: ids.jobA, jobTitle: 'Oferta a-active', jobSlug: 'a-active',
      offerSentAt: null, name: 'Kand Nr1', role: 'Operator wózka', city: 'Gent', match: 91,
    }]);
  });

  it('lejek rekrutacyjny i lejek ofert dla rekrutera', async () => {
    actAs(ownerA);
    expect(await employer.getFunnelStats()).toEqual({
      status: 'ok', funnel: { views: 0, applications: 13, interviews: 1, hired: 0 },
    });
    const jobFunnel = await employer.getJobFunnel(30);
    expect(jobFunnel.status).toBe('ok');
    if (jobFunnel.status === 'ok') {
      expect(jobFunnel.jobs.map((j) => j.jobId)).not.toContain(ids.jobB);
      expect(jobFunnel.totals.applicationsSubmitted).toBe(13);
    }
  });

  it('szczegół zgłoszenia: własna firma widzi profil i historię, obca firma = not_found', async () => {
    actAs(ownerA);
    const detail = await employer.getEmployerApplicationDetail(appsA[0]!);
    expect(detail.status).toBe('ok');
    if (detail.status !== 'ok') return;
    expect(detail.application).toMatchObject({
      id: appsA[0], candidateId: candidates[0], jobId: ids.jobA, jobTitle: 'Oferta a-active',
      message: 'Wiadomość 0', matchScore: 91, isGuest: false,
      profile: { headline: 'Operator wózka', city: 'Gent', experienceYears: 4, skills: ['Wózek widłowy'] },
    });
    expect(detail.application.history.map((h) => h.toStatus)).toContain('interview');

    actAs(ownerB);
    expect(await employer.getEmployerApplicationDetail(appsA[0]!)).toEqual({ status: 'not_found' });
    expect(await employer.getEmployerApplicationDetail('nie-uuid')).toEqual({ status: 'not_found' });
  });

  it('kreator: szkic własnej firmy z relacjami; obca firma = not-found; zamknięta = not-editable', async () => {
    actAs(ownerA);
    const draft = await employer.getJobDraft(ids.jobADraft);
    expect(draft).toMatchObject({ status: 'ok', jobId: ids.jobADraft, jobStatus: 'draft', contentLocale: 'pl' });
    if (draft.status === 'ok') {
      expect(draft.values).toMatchObject({
        title: 'Oferta draft-a', description: 'Opis szkicu', responsibilities: ['Obsługa wózka'],
        requirementsMandatory: ['Pierwsze', 'Drugie'], requirementsOptional: ['Mile widziane'],
        mandatorySkills: ['Wózek'], skills: ['Excel'], screeningQuestions: [],
      });
      expect(draft.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
    expect(await employer.getJobDraft(ids.jobAClosed)).toEqual({ status: 'not-editable', jobStatus: 'closed' });
    expect(await employer.getJobDraft(ids.jobAExpired)).toEqual({ status: 'not-editable', jobStatus: 'expired' });

    actAs(ownerB);
    expect(await employer.getJobDraft(ids.jobADraft)).toEqual({ status: 'not-found' });
  });

  it('chrome panelu: realna firma i imię z profilu; uprawnienia planu czytelne dla członka', async () => {
    actAs(ownerA);
    expect(await employer.getEmployerShellData()).toEqual({
      status: 'ok', companies: [{ id: ids.companyA, name: 'Firma A', role: 'owner' }], activeId: ids.companyA,
      activeName: 'Firma A', activeRole: 'owner', activeStatus: 'verified', userName: 'Olga Właścicielka',
    });
    const entitlements = await employer.getCompanyEntitlements();
    expect(entitlements).toMatchObject({ plan: expect.any(String), activeJobsUsed: expect.any(Number) });
  });

  it('gość / konto bez firmy nie czyta danych firmy', async () => {
    actAs(null);
    expect(await employer.getEmployerApplicationsPage(1)).toEqual({ status: 'ok', applications: [], hasMore: false, isDemo: false });
    expect(await employer.getEmployerShellData()).toEqual({ status: 'error' });
    actAs({ id: candidates[0]!, role: 'candidate' });
    expect(await employer.getCompanyJobsLoad(1)).toEqual({ status: 'ok', jobs: [], hasNext: false });
    expect(await employer.getEmployerApplicationDetail(appsA[0]!)).toEqual({ status: 'not_found' });
  });

  it('płatności (odczyt, billing wyłączony): owner widzi subskrypcję i faktury, member i firma B nie', async () => {
    actAs(ownerA);
    const own = await getBilling();
    expect(own.subscription).toMatchObject({ plan: 'standard', status: 'active' });
    expect(own.invoices).toEqual([expect.objectContaining({ number: 'PB-1', status: 'paid', amountCents: 9900, pdfUrl: null })]);
    actAs(memberA);
    expect(await getBilling()).toMatchObject({ subscription: null, invoices: [] });
    actAs(ownerB);
    expect(await getBilling()).toMatchObject({ subscription: null, invoices: [] });
  });

  it('kanoniczne miasto (P1-10): podpowiedź kreatora ze słownika pod RLS i location_id ofert', async () => {
    actAs(ownerA);
    expect(await jobCityAssist({ city: 'anvers', locale: 'nl' })).toMatchObject({
      status: 'ok', match: { slug: 'antwerp', name: 'Antwerpen' },
    });
    const prefix = await jobCityAssist({ city: 'Charl', locale: 'pl' });
    expect(prefix.status === 'ok' && prefix.suggestions).toContain('Charleroi');
    // Znaki LIKE we wpisie nie działają jak wzorzec.
    expect(await jobCityAssist({ city: '%', locale: 'pl' })).toEqual({ status: 'ok', match: null, suggestions: [] });
    expect(await jobCityAssist({ city: 'Nieznanowo', locale: 'pl' })).toMatchObject({ status: 'ok', match: null });
    // Oferty fixture'u zapisane jako „Antwerp” mają miejscowość ze słownika (trigger 0200).
    const { rows } = await pg.admin.query(`SELECT count(*)::int AS n FROM public.jobs j
      JOIN public.locations l ON l.id = j.location_id WHERE j.company_id = $1 AND l.slug = 'antwerp'`, [ids.companyA]);
    expect(rows[0].n).toBe(14);
  });
});
