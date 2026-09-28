import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { PortalIdentity } from '../../src/lib/auth/session';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb, type PortalDb } from './support/portal-db';

/**
 * Narzędzia rekrutera (0940) na PostgreSQL 16: filtr statusu listy zgłoszeń, akcja zbiorcza
 * przez `bulk_transition_applications` (firma widoku, recruiter+), scalanie e-maili o statusie
 * (LIM17-01), szablony odpowiedzi i język kandydata w kompozytorze (Invariant #1).
 */

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const employer = await import('../../src/lib/data/employer');
const { bulkTransitionApplications, transitionApplication } = await import('../../src/lib/actions/applications');
const { saveMessageTemplate } = await import('../../src/lib/actions/message-templates');
const { getComposerTemplates, getMessageTemplatesPage } = await import('../../src/lib/data/message-templates');

let pg: PortalDb;
let owner: PortalIdentity;
let member: PortalIdentity;
let companyA: string;
let companyB: string;
const apps: string[] = [];
let foreignApp: string;
let conversation: string;

beforeAll(async () => {
  pg = await startPortalDb();
  realSession.db = pg;
  owner = { id: await pg.createUser('employer', 'pl'), role: 'employer' };
  member = { id: await pg.createUser('employer', 'pl'), role: 'employer' };
  const ownerB = await pg.createUser('employer', 'pl');
  companyA = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma A', 'verified') RETURNING id`)).rows[0].id;
  companyB = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma B', 'verified') RETURNING id`)).rows[0].id;
  await pg.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active)
    VALUES ($1, $2, 'owner', true), ($1, $3, 'member', true), ($4, $5, 'owner', true)`,
    [companyA, owner.id, member.id, companyB, ownerB]);
  const job = async (company: string, slug: string) => (await pg.admin.query(
    `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at)
     VALUES ($1, $2, $3, 'active', 'warehouse', 'permanent', 'Gent', 'Flandria', now()) RETURNING id`,
    [company, slug, `Oferta ${slug}`])).rows[0].id as string;
  const jobA = await job(companyA, 'rt-a');
  const jobB = await job(companyB, 'rt-b');
  for (const locale of ['fr', 'nl', 'en']) {
    const candidate = await pg.createUser('candidate', locale);
    apps.push((await pg.admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status)
      VALUES ($1, $2, $3, 'submitted') RETURNING id`, [jobA, candidate, companyA])).rows[0].id);
    if (locale === 'fr') {
      conversation = (await pg.admin.query(`INSERT INTO public.conversations(company_id, job_id, created_by)
        VALUES ($1, $2, $3) RETURNING id`, [companyA, jobA, candidate])).rows[0].id;
      await pg.admin.query(`INSERT INTO public.conversation_members(conversation_id, profile_id)
        VALUES ($1, $2), ($1, $3)`, [conversation, candidate, owner.id]);
    }
  }
  const candidateB = await pg.createUser('candidate', 'pl');
  foreignApp = (await pg.admin.query(`INSERT INTO public.applications(job_id, candidate_id, company_id, status)
    VALUES ($1, $2, $3, 'submitted') RETURNING id`, [jobB, candidateB, companyB])).rows[0].id;
});

afterAll(async () => { await realSession.db?.stop(); });

describe('narzędzia rekrutera na PostgreSQL (0940)', () => {
  it('akcja zbiorcza: wynik per zgłoszenie, cudze = not_found; lista filtruje po statusie', async () => {
    actAs(owner);
    const result = await bulkTransitionApplications([apps[0]!, apps[1]!, foreignApp], 'rejected', companyA);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = new Map(result.results.map((r) => [r.applicationId, r.outcome]));
    expect(byId.get(apps[0]!)).toBe('changed');
    expect(byId.get(apps[1]!)).toBe('changed');
    expect(byId.get(foreignApp)).toBe('not_found');
    const { rows } = await pg.admin.query('SELECT status::text AS s FROM public.applications WHERE id = $1', [foreignApp]);
    expect(rows[0].s).toBe('submitted');

    const rejected = await employer.getEmployerApplicationsPage(undefined, null, 'rejected');
    expect(rejected.status).toBe('ok');
    if (rejected.status !== 'ok') return;
    expect(rejected.applications.map((a) => a.id).sort()).toEqual([apps[0]!, apps[1]!].sort());
    expect(rejected.companyId).toBe(companyA);
    expect(rejected.jobOptions.map((j) => j.title)).toEqual(['Oferta rt-a']);
    const submitted = await employer.getEmployerApplicationsPage(undefined, null, 'submitted');
    expect(submitted.status === 'ok' && submitted.applications.map((a) => a.id)).toEqual([apps[2]!]);

    // Ponowienie tej samej operacji: bez drugiego przejścia.
    const again = await bulkTransitionApplications([apps[0]!], 'rejected', companyA);
    expect(again).toEqual({ ok: true, results: [{ applicationId: apps[0]!, outcome: 'unchanged' }] });
  });

  it('firma inna niż aktywna i rola member: brak zmian', async () => {
    actAs(owner);
    expect(await bulkTransitionApplications([apps[2]!], 'rejected', companyB)).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    actAs(member);
    expect(await bulkTransitionApplications([apps[2]!], 'rejected', companyA)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    const { rows } = await pg.admin.query('SELECT status::text AS s FROM public.applications WHERE id = $1', [apps[2]!]);
    expect(rows[0].s).toBe('submitted');
  });

  it('cykl statusów bez wysyłki workera = jeden oczekujący e-mail (LIM17-01)', async () => {
    actAs(owner);
    for (const target of ['shortlisted', 'interview', 'shortlisted', 'interview']) {
      expect(await transitionApplication(apps[2]!, target)).toEqual({ ok: true });
    }
    const { rows } = await pg.admin.query(`SELECT status::text AS s, error_message FROM public.email_deliveries
      WHERE entity_id = $1 AND template = 'statusChanged'`, [apps[2]!]);
    expect(rows.filter((r) => r.s === 'queued')).toHaveLength(1);
    expect(rows.filter((r) => r.error_message === 'suppressed_superseded')).toHaveLength(3);
  });

  it('szablony: zapis, odczyt recruiter+, kompozytor zna język kandydata', async () => {
    actAs(owner);
    const saved = await saveMessageTemplate(
      { id: null, name: 'Zaproszenie', variants: { pl: 'Zapraszamy {imie}', fr: 'Bonjour {imie}' }, expectedUpdatedAt: null },
      companyA,
    );
    expect(saved.ok).toBe(true);
    const page = await getMessageTemplatesPage();
    expect(page.status).toBe('ok');
    if (page.status !== 'ok') return;
    expect(page.templates).toHaveLength(1);
    expect(page.templates[0]!.variants).toEqual({ pl: 'Zapraszamy {imie}', fr: 'Bonjour {imie}' });

    // CAS: edycja z aktualnym znacznikiem przechodzi, z nieaktualnym — STALE_STATE.
    const edit = await saveMessageTemplate(
      { id: page.templates[0]!.id, name: 'Zaproszenie 2', variants: { fr: 'Bonjour' }, expectedUpdatedAt: page.templates[0]!.updatedAt },
      companyA,
    );
    expect(edit.ok).toBe(true);
    const stale = await saveMessageTemplate(
      { id: page.templates[0]!.id, name: 'Zaproszenie 3', variants: { fr: 'x' }, expectedUpdatedAt: page.templates[0]!.updatedAt },
      companyA,
    );
    expect(stale).toEqual({ ok: false, error: 'STALE_STATE' });

    const composer = await getComposerTemplates(conversation);
    expect(composer).toMatchObject({ candidateLocale: 'fr', companyName: 'Firma A', jobTitle: 'Oferta rt-a' });
    expect(composer?.templates.map((t) => t.name)).toEqual(['Zaproszenie 2']);

    actAs(member);
    expect(await getMessageTemplatesPage()).toEqual({ status: 'denied' });
    expect(await saveMessageTemplate(
      { id: null, name: 'X', variants: { pl: 'x' }, expectedUpdatedAt: null }, companyA,
    )).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });
});
