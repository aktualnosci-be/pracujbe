import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';
import type { PortalIdentity } from '../../src/lib/auth/session';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));

const actions = await import('../../src/lib/actions/appeals');
const dsa = await import('../../src/lib/data/admin-dsa');

// #25/#43: odwołania DSA na PostgreSQL 16 — autor pod sesją (RLS/członkostwo w RPC),
// zgłaszający przez service_role z kodem dostępu, kolejka i raport tylko po roli admina.
const CODE = 'ABCDEFGHIJKLMNOPQRSTUVWX';
const FACTS = 'Oferta żąda od kandydatów opłaty za rekrutację z góry.';
const GROUNDS = 'Nie pobieramy opłat; wymóg był błędem w szablonie ogłoszenia.';
const REASONING = 'Autor wykazał, że opłata nie była pobierana od kandydatów.';

let decider: PortalIdentity;
let reviewer: PortalIdentity;
let owner: PortalIdentity;
let stranger: PortalIdentity;
let candidate: PortalIdentity;
let restrictDecision: string;
let noActionCase: string;
let restrictedJob: string;

function db() {
  return realSession.db!;
}

async function makeJob(companyId: string, slug: string): Promise<string> {
  const { rows } = await db().admin.query(
    `INSERT INTO public.jobs(company_id, slug, title, category, contract_type, city, region, status, default_locale)
     VALUES ($1, $2, 'Magazynier IT', 'warehouse', 'permanent', 'Antwerpia', 'Flandria', 'active', 'pl') RETURNING id`,
    [companyId, slug],
  );
  return rows[0].id;
}

async function report(jobId: string, email: string): Promise<{ id: string; caseNumber: string }> {
  const client = await db().service.connect();
  try {
    const { rows } = await client.query(
      `SELECT report_id, case_number FROM public.submit_content_report(NULL, $1, $2, 'job', $3, 'fraud',
         'Oferta wymaga opłaty za rekrutację z góry.', NULL, NULL, $4, 'nl', true)`,
      [randomUUID(), CODE, jobId, email],
    );
    return { id: rows[0].report_id, caseNumber: rows[0].case_number };
  } finally {
    client.release();
  }
}

/** Decyzja admina pod jego sesją (jak w panelu). */
async function decide(adminId: string, reportId: string, decision: string, facts: string, ground?: [string, string]) {
  const client = await db().admin.connect();
  try {
    await client.query('BEGIN');
    await client.query('SET LOCAL ROLE authenticated');
    await client.query(`SELECT set_config('app.current_uid', $1, true)`, [adminId]);
    const { rows } = await client.query(
      'SELECT public.admin_decide_report($1, $2, $3, $4, $5, $6) AS id',
      [reportId, 'open', decision, facts, ground?.[0] ?? null, ground?.[1] ?? null],
    );
    await client.query('COMMIT');
    return rows[0].id as string;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

beforeAll(async () => {
  const pg = await startPortalDb();
  realSession.db = pg;
  const [deciderId, reviewerId, ownerId, strangerId, candidateId] = [
    await pg.createUser('candidate', 'pl'),
    await pg.createUser('candidate', 'pl'),
    await pg.createUser('employer', 'nl'),
    await pg.createUser('employer', 'fr'),
    await pg.createUser('candidate', 'en'),
  ];
  await pg.admin.query(`UPDATE public.profiles SET role = 'admin' WHERE id = ANY($1::uuid[])`, [[deciderId, reviewerId]]);
  decider = { id: deciderId, role: 'admin' };
  reviewer = { id: reviewerId, role: 'admin' };
  owner = { id: ownerId, role: 'employer' };
  stranger = { id: strangerId, role: 'employer' };
  candidate = { id: candidateId, role: 'candidate' };

  const company = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Firma Odwołań IT', 'verified') RETURNING id`)).rows[0].id;
  const other = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Obca IT', 'verified') RETURNING id`)).rows[0].id;
  await pg.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active) VALUES ($1, $2, 'owner', true), ($3, $4, 'owner', true)`,
    [company, ownerId, other, strangerId]);

  restrictedJob = await makeJob(company, 'apl-it-1');
  const noActionJob = await makeJob(company, 'apl-it-2');
  const r1 = await report(restrictedJob, 'apl-it-1@example.invalid');
  const r2 = await report(noActionJob, 'apl-it-2@example.invalid');
  restrictDecision = await decide(deciderId, r1.id, 'job_removed', FACTS, ['terms', 'Regulamin § 4']);
  await decide(deciderId, r2.id, 'no_action', 'Treść nie narusza regulaminu ani prawa.');
  noActionCase = r2.caseNumber;
});

afterAll(async () => { await realSession.db?.stop(); });

describe('odwołania na PostgreSQL (#25) — autor i zgłaszający', () => {
  it('obca firma, kandydat i gość nie odwołują się od cudzej decyzji', async () => {
    actAs(stranger);
    expect(await actions.submitModerationAppeal(restrictDecision, GROUNDS, randomUUID())).toEqual({ ok: false, error: 'NOT_FOUND' });
    actAs(candidate);
    expect(await actions.submitModerationAppeal(restrictDecision, GROUNDS, randomUUID())).toEqual({ ok: false, error: 'NOT_FOUND' });
    actAs(null);
    expect(await actions.submitModerationAppeal(restrictDecision, GROUNDS, randomUUID())).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    const count = await db().admin.query('SELECT count(*)::int AS n FROM public.moderation_appeals');
    expect(count.rows[0].n).toBe(0);
  });

  it('autor: odwołanie pod sesją, ponowienie tym samym kluczem = to samo, drugie = APPEAL_EXISTS', async () => {
    actAs(owner);
    const key = randomUUID();
    const first = await actions.submitModerationAppeal(restrictDecision, `  ${GROUNDS}  `, key);
    expect(first).toMatchObject({ ok: true, created: true });
    const again = await actions.submitModerationAppeal(restrictDecision, GROUNDS, key);
    expect(again).toMatchObject({ ok: true, created: false });
    if (first.ok && again.ok) expect(again.reference).toBe(first.reference);
    expect(await actions.submitModerationAppeal(restrictDecision, GROUNDS, randomUUID())).toEqual({ ok: false, error: 'APPEAL_EXISTS' });
    const { rows } = await db().admin.query('SELECT appellant_id, appellant_role, grounds FROM public.moderation_appeals WHERE decision_id = $1', [restrictDecision]);
    expect(rows).toEqual([{ appellant_id: owner.id, appellant_role: 'author', grounds: GROUNDS }]);
  });

  it('zgłaszający: numer + kod przez service_role; zły kod = NOT_FOUND', async () => {
    actAs(null);
    expect(await actions.submitReportAppeal({ caseNumber: noActionCase, accessCode: 'B'.repeat(24), grounds: GROUNDS, idempotencyKey: randomUUID() }))
      .toEqual({ ok: false, error: 'NOT_FOUND' });
    const result = await actions.submitReportAppeal({
      caseNumber: noActionCase.toLowerCase(), accessCode: CODE.toLowerCase(), grounds: GROUNDS, idempotencyKey: randomUUID(),
    });
    expect(result).toMatchObject({ ok: true, created: true });
  });
});

describe('odwołania na PostgreSQL (#25) — panel admina', () => {
  it('kolejka, raport, eksport i retencja: nie-admin i gość → notFound', async () => {
    for (const who of [owner, candidate, null]) {
      actAs(who);
      await expect(dsa.listAppeals()).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(dsa.getTransparencyReport(new Date('2020-01-01'), new Date('2100-01-01'))).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(dsa.getStatementsExport(new Date('2020-01-01'), new Date('2100-01-01'))).rejects.toThrow('NEXT_NOT_FOUND');
      await expect(dsa.getRetentionOverview()).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('kolejka: oczekujące z decyzją i sprawą; konflikt osoby rozpatrującej dla autora decyzji', async () => {
    actAs(decider);
    const result = await dsa.listAppeals();
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.decided).toEqual([]);
    expect(result.pending).toHaveLength(2);
    const author = result.pending.find((a) => a.role === 'author')!;
    expect(author).toMatchObject({
      status: 'pending',
      grounds: GROUNDS,
      reviewerConflict: true,
      decision: { id: restrictDecision, decision: 'job_removed', groundType: 'terms', groundReference: 'Regulamin § 4' },
      report: { targetType: 'job', category: 'fraud' },
    });
    expect(author.reference).toMatch(/^APL-/);
    expect(author.submittedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    actAs(reviewer);
    const other = await dsa.listAppeals();
    expect(other.status === 'ok' && other.pending.every((a) => !a.reviewerConflict)).toBe(true);
  });

  it('rozpatrzenie: autor decyzji → REVIEWER_CONFLICT; inny admin uwzględnia; powtórka → STALE_STATE; nie-admin odrzucony', async () => {
    actAs(decider);
    const queue = await dsa.listAppeals();
    if (queue.status !== 'ok') throw new Error('expected ok');
    const appeal = queue.pending.find((a) => a.role === 'author')!;
    const input = { outcome: 'reversed', reasoning: REASONING };

    expect(await actions.decideAppeal(appeal.id, 'pending', 'author', 'job', input)).toEqual({ ok: false, error: 'REVIEWER_CONFLICT' });
    actAs(owner);
    expect(await actions.decideAppeal(appeal.id, 'pending', 'author', 'job', input)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(reviewer);
    expect(await actions.decideAppeal(appeal.id, 'pending', 'author', 'job', input)).toEqual({ ok: true });
    expect(await actions.decideAppeal(appeal.id, 'pending', 'author', 'job', input)).toEqual({ ok: false, error: 'STALE_STATE' });

    const job = await db().admin.query('SELECT status FROM public.jobs WHERE id = $1', [restrictedJob]);
    expect(job.rows[0].status).toBe('active');
    const after = await dsa.listAppeals();
    if (after.status !== 'ok') throw new Error('expected ok');
    expect(after.pending).toHaveLength(1);
    expect(after.decided).toEqual([expect.objectContaining({ id: appeal.id, status: 'reversed', reasoning: REASONING, sameReviewer: false })]);
  });

  it('raport przejrzystości, eksport bez danych osobowych i podgląd retencji dla admina', async () => {
    actAs(reviewer);
    const from = new Date(Date.now() - 86_400_000);
    const to = new Date(Date.now() + 86_400_000);
    const result = await dsa.getTransparencyReport(from, to);
    if (result.status !== 'ok') throw new Error('expected ok');
    expect(result.report.notices.total).toBe(2);
    expect(result.report.decisions.total).toBe(2);
    expect(result.report.appeals.total).toBe(2);
    expect(result.report.restorations.viaAppeal).toBe(1);

    const exported = await dsa.getStatementsExport(from, to);
    if (exported.status !== 'ok') throw new Error('expected ok');
    expect(exported.rows).toHaveLength(2);
    expect(exported.rows.map((r) => r.decision).sort()).toEqual(['job_removed', 'no_action']);
    expect(Object.keys(exported.rows[0]!)).toEqual([...dsa.DSA_EXPORT_COLUMNS]);

    const retention = await dsa.getRetentionOverview();
    if (retention.status !== 'ok') throw new Error('expected ok');
    expect(retention.overview.appealWindowDays).toBeGreaterThan(0);
    expect(retention.overview.runs).toEqual([]);
  });
});
