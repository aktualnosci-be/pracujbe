import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';
import type { PortalIdentity } from '../../src/lib/auth/session';
import { withUserTransaction } from '../../src/lib/db/transaction';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
// Aktywna firma szczegółu zgłoszenia (#497): bez cookie → pierwsze członkostwo.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const adminData = await import('../../src/lib/data/admin');
const adminActions = await import('../../src/lib/actions/admin');
const jobs = await import('../../src/lib/actions/jobs');
const banner = await import('../../src/lib/campaign-banner/source');
const employerData = await import('../../src/lib/data/employer');
const { getPublicJobScreeningQuestions } = await import('../../src/lib/db/public-jobs');

// #25 po scaleniu #497 i #175: przegląd pytań screeningowych (publikacja zablokowana do decyzji,
// kolejka admina przez service_role po roli, decyzja pod sesją admina) oraz baner kampanii
// z odczytem pod sesją — na PostgreSQL 16 z migracjami produkcyjnymi.
let admin: PortalIdentity;
let owner: PortalIdentity;
let candidate: PortalIdentity;
let outsider: PortalIdentity;
let jobId: string;

beforeAll(async () => {
  const pg = await startPortalDb();
  realSession.db = pg;
  const adminId = await pg.createUser('candidate', 'pl');
  await pg.admin.query(`UPDATE public.profiles SET role = 'admin' WHERE id = $1`, [adminId]);
  admin = { id: adminId, role: 'admin' };
  owner = { id: await pg.createUser('employer', 'nl'), role: 'employer' };
  outsider = { id: await pg.createUser('employer', 'fr'), role: 'employer' };
  candidate = { id: await pg.createUser('candidate', 'pl'), role: 'candidate' };

  const company = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Magazyn IT', 'verified') RETURNING id`)).rows[0].id;
  const other = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Obca IT', 'verified') RETURNING id`)).rows[0].id;
  await pg.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active) VALUES ($1, $2, 'owner', true), ($3, $4, 'owner', true)`,
    [company, owner.id, other, outsider.id]);
  jobId = (await pg.admin.query(`INSERT INTO public.jobs(company_id, created_by, slug, title, category, contract_type, city, region, status, default_locale)
    VALUES ($1, $2, 'draft-it-sr', 'Magazynier IT', 'warehouse', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl') RETURNING id`, [company, owner.id])).rows[0].id;
  await pg.admin.query(`INSERT INTO public.job_translations(job_id, locale, title, description, responsibilities)
    VALUES ($1, 'pl', 'Magazynier IT', 'Praca w magazynie w Gandawie.', array['Kompletacja zamówień'])`, [jobId]);
  await pg.admin.query(`INSERT INTO public.job_requirements(job_id, locale, kind, position, content) VALUES ($1, 'pl', 'mandatory', 0, 'Dyspozycyjność')`, [jobId]);
  // Zapis kroku z pytaniem, które detektor w bazie kieruje do przeglądu (data urodzenia).
  await withUserTransaction(pg.web, owner.id, (tx) => tx.query(
    `SELECT public.save_job_draft($1::uuid, $2::jsonb)`,
    [jobId, JSON.stringify({ screening_questions: [{ type: 'date', prompt: { pl: 'Podaj datę urodzenia' } }] })]));
});

afterAll(async () => { await realSession.db?.stop(); });

describe('przegląd pytań screeningowych (#497) na nowej warstwie danych', () => {
  it('publikacja czeka na przegląd; kreator dostaje oznaczone pytania z osobnej transakcji', async () => {
    actAs(owner);
    const result = await jobs.publishJob(jobId);
    expect(result).toMatchObject({ ok: false, error: 'SCREENING_REVIEW_REQUIRED' });
    expect(result.ok === false && 'screening' in result ? result.screening?.length : 0).toBeGreaterThan(0);
  });

  it('kolejka tylko dla admina (inni → notFound); decyzja pod sesją admina odblokowuje publikację', async () => {
    for (const who of [owner, candidate, null]) {
      actAs(who);
      await expect(adminData.listScreeningReviews()).rejects.toThrow('NEXT_NOT_FOUND');
    }
    actAs(admin);
    const list = await adminData.listScreeningReviews();
    expect(list.status).toBe('ok');
    const row = list.status === 'ok' ? list.rows.find((r) => r.jobId === jobId) : undefined;
    expect(row).toMatchObject({ status: 'pending', current: true, companyName: 'Magazyn IT', categories: ['age'] });

    actAs(owner);
    expect((await adminActions.decideScreeningReview(row!.id, 'approved', '')).ok).toBe(false);
    actAs(admin);
    expect(await adminActions.decideScreeningReview(row!.id, 'approved', '')).toEqual({ ok: true });
    const decided = await adminData.listScreeningReviews({ status: 'decided' });
    expect(decided.status === 'ok' ? decided.rows.map((r) => r.status) : []).toEqual(['approved']);

    actAs(owner);
    expect(await jobs.publishJob(jobId)).toEqual({ ok: true });
  });
});

describe('pytanie odrzucone po publikacji jest ukrywane (#497, 0201)', () => {
  it('oferta aktywna, pytanie znika z formularza, firma nie widzi odpowiedzi, powiadomienie recruiter+', async () => {
    const pg = realSession.db!;
    const company = (await pg.admin.query(`SELECT company_id FROM public.jobs WHERE id = $1`, [jobId])).rows[0].company_id;
    const activeJob = (await pg.admin.query(`INSERT INTO public.jobs(company_id, created_by, slug, title, category, contract_type, city, region, status, default_locale)
      VALUES ($1, $2, 'it-sh497', 'Kierowca IT', 'transport', 'permanent', 'Gandawa', 'Flandria', 'draft', 'pl') RETURNING id`, [company, owner.id])).rows[0].id;
    await pg.admin.query(`INSERT INTO public.job_translations(job_id, locale, title) VALUES ($1, 'pl', 'Kierowca IT')`, [activeJob]);
    await pg.admin.query(`INSERT INTO public.job_screening_questions(job_id, position, type, required, prompt) VALUES
      ($1, 0, 'yes_no', true, '{"pl": "Czy masz prawo jazdy C+E?"}'), ($1, 1, 'yes_no', true, '{"pl": "Czy jesteś w ciąży?"}')`, [activeJob]);
    // Oferta opublikowana przed przeglądem (stan jak po 0103): aktywna, pytanie w kolejce.
    await pg.admin.query(`ALTER TABLE public.jobs DISABLE TRIGGER trg_enforce_screening_review`);
    await pg.admin.query(`UPDATE public.jobs SET status = 'active', published_at = now() WHERE id = $1`, [activeJob]);
    await pg.admin.query(`ALTER TABLE public.jobs ENABLE TRIGGER trg_enforce_screening_review`);
    const questions = (await pg.admin.query(`SELECT id, position FROM public.job_screening_questions WHERE job_id = $1 ORDER BY position`, [activeJob])).rows;
    const [visible, risky] = questions.map((q: { id: string }) => q.id);
    const applied = (await withUserTransaction(pg.web, candidate.id, (tx) => tx.query(
      `SELECT public.apply_to_job($1::uuid, 'it-sh497-1', null, null, null, $2::jsonb) AS id`,
      [activeJob, JSON.stringify({ [visible!]: true, [risky!]: false })]))) as { rows: { id: string }[] };
    const applicationId = applied.rows[0]!.id;

    actAs(owner);
    const before = await employerData.getEmployerApplicationDetail(applicationId);
    expect(before.status === 'ok' ? before.application.screeningAnswers?.length : -1).toBe(2);
    expect((await getPublicJobScreeningQuestions(pg.web, activeJob)).map((q) => q.id)).toEqual([visible, risky]);

    actAs(admin);
    const list = await adminData.listScreeningReviews();
    const row = list.status === 'ok' ? list.rows.find((r) => r.jobId === activeJob) : undefined;
    expect(await adminActions.decideScreeningReview(row!.id, 'rejected', 'Pytanie o ciążę.')).toEqual({ ok: true });

    expect((await pg.admin.query(`SELECT status FROM public.jobs WHERE id = $1`, [activeJob])).rows[0].status).toBe('active');
    expect((await getPublicJobScreeningQuestions(pg.web, activeJob)).map((q) => q.id)).toEqual([visible]);
    actAs(owner);
    const after = await employerData.getEmployerApplicationDetail(applicationId);
    expect(after.status === 'ok' ? after.application.screeningAnswers?.length : -1).toBe(1);
    // Wiersz odpowiedzi zostaje w bazie; powiadomienie z prośbą o poprawkę dla ownera.
    expect((await pg.admin.query(`SELECT count(*)::int AS n FROM public.application_screening_answers WHERE application_id = $1`, [applicationId])).rows[0].n).toBe(2);
    const notes = (await pg.admin.query(`SELECT data FROM public.notifications WHERE profile_id = $1 AND entity_id = $2`, [owner.id, activeJob])).rows;
    expect(notes.map((n) => n.data)).toEqual([expect.objectContaining({ kind: 'screening_review', status: 'hidden' })]);
  });
});

describe('baner kampanii (#175) pod sesją', () => {
  it('recruiter+ firmy i admin widzą ofertę; obca firma i kandydat — jednakowo niedostępna', async () => {
    for (const who of [owner, admin]) {
      const loaded = await banner.loadManagedCampaignJob(who, jobId, 'pl');
      expect(loaded).toMatchObject({ status: 'ok', job: expect.objectContaining({ title: 'Magazynier IT' }) });
    }
    for (const who of [outsider, candidate]) {
      expect(await banner.loadManagedCampaignJob(who, jobId, 'pl')).toEqual({ status: 'unavailable' });
    }
  });
});
