import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';
import type { PortalIdentity } from '../../src/lib/auth/session';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
// VIES to usługa zewnętrzna — w teście bazy podstawiamy rozstrzygający wynik.
vi.mock('@/lib/vies/client', () => ({
  checkBelgianVatInVies: vi.fn(async () => ({
    status: 'valid',
    vatNumber: '0417497106',
    name: 'NV IT VIES',
    requestDate: '2026-09-24',
    checkedAt: '2026-09-24T10:00:00.000Z',
  })),
}));

const data = await import('../../src/lib/data/admin');
const actions = await import('../../src/lib/actions/admin');
const { ADMIN_PAGE_SIZE } = await import('../../src/lib/admin/list-params');

// #25: panel administratora na PostgreSQL 16 — odczyty service_role wyłącznie po roli admina,
// kursory (created_at, id) bez duplikatów, wyszukiwanie w SQL, RPC admin_* pod sesją admina.
let admin: PortalIdentity;
let candidate: PortalIdentity;
let employer: PortalIdentity;
let pendingCompany: string;
let viesCompany: string;
let ownedCompany: string;
let suppression: string;
let report: string;
const COMPANIES = ADMIN_PAGE_SIZE + 7;

function db() {
  return realSession.db!;
}

beforeAll(async () => {
  const pg = await startPortalDb();
  realSession.db = pg;
  const adminId = await pg.createUser('candidate', 'pl');
  await pg.admin.query(`UPDATE public.profiles SET role = 'admin', first_name = 'Ada', last_name = 'Admin' WHERE id = $1`, [adminId]);
  const candidateId = await pg.createUser('candidate', 'nl');
  await pg.admin.query(`UPDATE public.profiles SET first_name = 'Karel', last_name = 'Kandidaat' WHERE id = $1`, [candidateId]);
  const employerId = await pg.createUser('employer', 'fr');
  admin = { id: adminId, role: 'admin' };
  candidate = { id: candidateId, role: 'candidate' };
  employer = { id: employerId, role: 'employer' };

  // Firmy: co 5 ta sama data utworzenia — kursor musi rozstrzygać po `id`.
  await pg.admin.query(`INSERT INTO public.companies(name, status, vat_number, email, created_at)
    SELECT 'Firma IT ' || g,
           (CASE WHEN g % 3 = 0 THEN 'pending' ELSE 'verified' END)::company_status,
           'BE09' || lpad(g::text, 8, '0'),
           'firma' || g || '@example.invalid',
           timestamptz '2026-01-01 10:00:00.123456+00' + ((g / 5) || ' minutes')::interval
      FROM generate_series(1, ${COMPANIES - 3}) g`);
  pendingCompany = (await pg.admin.query(`INSERT INTO public.companies(name, status) VALUES ('Kolejka Weryfikacji', 'pending') RETURNING id`)).rows[0].id;
  viesCompany = (await pg.admin.query(`INSERT INTO public.companies(name, status, vat_number) VALUES ('NV IT VIES', 'verified', 'BE0417497106') RETURNING id`)).rows[0].id;
  ownedCompany = (await pg.admin.query(`INSERT INTO public.companies(name, status, email) VALUES ('Właściciel IT', 'verified', 'owner@example.invalid') RETURNING id`)).rows[0].id;
  await pg.admin.query(`INSERT INTO public.company_members(company_id, profile_id, role, is_active) VALUES ($1, $2, 'owner', true)`, [ownedCompany, employerId]);
  await pg.admin.query(`INSERT INTO public.companies(name, status, deleted_at) VALUES ('Usunięta IT', 'verified', now())`);

  report = (await pg.admin.query(`INSERT INTO public.reports(reporter_id, target_type, target_id, reason, details)
    VALUES ($1, 'company', $2, 'fraud', 'Opłata za rekrutację') RETURNING id`, [candidateId, ownedCompany])).rows[0].id;
  await pg.admin.query(`INSERT INTO public.reports(target_type, target_id, reason, status)
    VALUES ('user', $1, 'spam', 'resolved')`, [candidateId]);

  suppression = (await pg.admin.query(`INSERT INTO public.email_suppressions(email, reason)
    VALUES ('odbicie_it@example.invalid', 'hard_bounce') RETURNING id`)).rows[0].id;
  await pg.admin.query(`INSERT INTO public.email_suppressions(email, reason) VALUES ('inny@example.invalid', 'complaint')`);
});

afterAll(async () => { await realSession.db?.stop(); });

describe('panel admina na PostgreSQL (#25) — dostęp', () => {
  const loaders = [
    ['getAdminStats', () => data.getAdminStats()],
    ['listCompanies', () => data.listCompanies()],
    ['listReports', () => data.listReports()],
    ['listUsers', () => data.listUsers()],
    ['listAuditLogs', () => data.listAuditLogs()],
    ['getCompanyDetail', () => data.getCompanyDetail(ownedCompany)],
    ['listEmailSuppressions', () => data.listEmailSuppressions()],
  ] as const;

  it.each(loaders)('%s: kandydat, pracodawca i gość → notFound (bez danych)', async (_name, load) => {
    for (const who of [candidate, employer, null]) {
      actAs(who);
      await expect(load()).rejects.toThrow('NEXT_NOT_FOUND');
    }
  });

  it('akcje: RPC odrzuca nie-admina, gość bez sesji, VIES bez roli admina', async () => {
    actAs(employer);
    expect(await actions.setCompanyStatus(pendingCompany, 'verified', 'pending')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await actions.resolveReport(report, 'reviewing', 'open')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(await actions.liftEmailSuppression(suppression, 'Adres potwierdzony')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(candidate);
    expect(await actions.checkCompanyVies(viesCompany)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(null);
    expect(await actions.setCompanyStatus(pendingCompany, 'verified', 'pending')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    const status = await db().admin.query('SELECT status FROM public.companies WHERE id = $1', [pendingCompany]);
    expect(status.rows[0].status).toBe('pending');
  });
});

describe('panel admina na PostgreSQL (#25) — listy', () => {
  it('statystyki liczą firmy (bez usuniętych), kolejkę, konta i otwarte zgłoszenia', async () => {
    actAs(admin);
    const result = await data.getAdminStats();
    const pending = Math.floor((COMPANIES - 3) / 3) + 1;
    expect(result).toEqual({
      status: 'ok',
      stats: { companies: COMPANIES, pendingCompanies: pending, users: 3, openReports: 1 },
    });
  });

  it('firmy: dwie strony kursorem bez duplikatów i pominięć, usunięta niewidoczna', async () => {
    actAs(admin);
    const first = await data.listCompanies();
    if (first.status !== 'ok') throw new Error('expected ok');
    expect(first.rows).toHaveLength(ADMIN_PAGE_SIZE);
    expect(first.nextCursor).not.toBeNull();
    const second = await data.listCompanies({ cursor: first.nextCursor });
    if (second.status !== 'ok') throw new Error('expected ok');
    expect(second.nextCursor).toBeNull();
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(ids).toHaveLength(COMPANIES);
    expect(new Set(ids).size).toBe(COMPANIES);
    expect([...first.rows, ...second.rows].some((r) => r.name === 'Usunięta IT')).toBe(false);
  });

  it('firmy: wyszukiwanie po VAT i e-mailu w SQL, filtr kolejki weryfikacji', async () => {
    actAs(admin);
    const byVat = await data.listCompanies({ q: 'BE0900000012' });
    expect(byVat).toMatchObject({ status: 'ok', rows: [{ name: 'Firma IT 12' }] });
    const byEmail = await data.listCompanies({ q: 'owner@example' });
    expect(byEmail).toMatchObject({ status: 'ok', rows: [{ id: ownedCompany }] });
    // `_` z frazy jest literałem, nie symbolem wieloznacznym LIKE.
    expect(await data.listCompanies({ q: 'Firma_IT' })).toEqual({ status: 'ok', rows: [], nextCursor: null });
    const awaiting = await data.listCompanies({ status: 'awaiting' });
    if (awaiting.status !== 'ok') throw new Error('expected ok');
    expect(awaiting.rows.every((r) => r.status === 'pending' || r.status === 'unverified')).toBe(true);
    expect(awaiting.rows.map((r) => r.id)).toContain(pendingCompany);
  });

  it('użytkownicy: wyszukiwanie i filtr roli; e-mail z profilu', async () => {
    actAs(admin);
    const found = await data.listUsers({ q: 'Kandidaat' });
    expect(found).toMatchObject({ status: 'ok', rows: [{ id: candidate.id, name: 'Karel Kandidaat', role: 'candidate' }] });
    if (found.status === 'ok') expect(found.rows[0]?.email).toBe(`${candidate.id}@example.invalid`);
    const employers = await data.listUsers({ role: 'employer' });
    expect(employers.status === 'ok' && employers.rows.map((r) => r.id)).toEqual([employer.id]);
  });

  it('zgłoszenia: domyślnie otwarte, cel i zgłaszający; `all` obejmuje rozstrzygnięte', async () => {
    actAs(admin);
    const active = await data.listReports();
    if (active.status !== 'ok') throw new Error('expected ok');
    expect(active.rows).toHaveLength(1);
    expect(active.rows[0]).toMatchObject({
      id: report,
      reporterName: 'Karel Kandidaat',
      target: { label: 'Właściciel IT', deleted: false },
      dsa: null,
    });
    const all = await data.listReports({ status: 'all' });
    expect(all.status === 'ok' && all.rows).toHaveLength(2);
    if (all.status === 'ok') {
      expect(all.rows.find((r) => r.targetType === 'user')?.target).toMatchObject({ label: 'Karel Kandidaat' });
    }
  });

  it('szczegół firmy: członkowie z profilem, licznik ofert; nieistniejąca → not_found', async () => {
    actAs(admin);
    const detail = await data.getCompanyDetail(ownedCompany);
    if (detail.status !== 'ok') throw new Error('expected ok');
    expect(detail.company.members).toEqual([
      expect.objectContaining({ role: 'owner', isActive: true, email: `${employer.id}@example.invalid` }),
    ]);
    expect(detail.company.jobsTotal).toBe(0);
    expect(await data.getCompanyDetail('00000000-0000-4000-8000-000000000000')).toEqual({ status: 'not_found' });
  });
});

describe('panel admina na PostgreSQL (#25) — akcje i dziennik', () => {
  it('admin_set_company_status: przejście z p_expected_status, nieaktualny status → STALE_STATE', async () => {
    actAs(admin);
    expect(await actions.setCompanyStatus(pendingCompany, 'verified', 'pending')).toEqual({ ok: true });
    expect(await actions.setCompanyStatus(pendingCompany, 'rejected', 'pending', 'Zły VAT')).toEqual({ ok: false, error: 'STALE_STATE' });
    expect(await actions.setCompanyStatus(pendingCompany, 'suspended', 'verified', 'Oszustwo')).toEqual({ ok: true });
    const row = await db().admin.query('SELECT status, status_reason FROM public.companies WHERE id = $1', [pendingCompany]);
    expect(row.rows[0]).toEqual({ status: 'suspended', status_reason: 'Oszustwo' });
  });

  it('dziennik: zmiany statusu z aktorem-adminem, filtr obiektu i aktora „system”', async () => {
    actAs(admin);
    const history = await data.listAuditLogs({ entityId: pendingCompany, action: 'company.status_changed' });
    if (history.status !== 'ok') throw new Error('expected ok');
    expect(history.rows.map((r) => [r.statusBefore, r.statusAfter])).toEqual([['verified', 'suspended'], ['pending', 'verified']]);
    expect(history.rows[0]).toMatchObject({
      actorId: admin.id,
      actorName: 'Ada Admin',
      entityLabel: 'Kolejka Weryfikacji',
      entityHref: { pathname: `/admin/firmy/${pendingCompany}` },
      reason: 'Oszustwo',
    });
    const byActor = await data.listAuditLogs({ actor: 'Ada' });
    expect(byActor.status === 'ok' && byActor.rows.every((r) => r.actorId === admin.id)).toBe(true);
    const system = await data.listAuditLogs({ actor: 'system', entity: 'company' });
    if (system.status !== 'ok') throw new Error('expected ok');
    expect(system.rows.length).toBeGreaterThan(0);
    expect(system.rows.every((r) => r.actorId === null)).toBe(true);
    expect(await data.listAuditLogs({ actor: 'Nikt Taki' })).toEqual({ status: 'ok', rows: [], nextCursor: null });
  });

  it('dziennik: dwie strony kursorem bez duplikatów', async () => {
    actAs(admin);
    const first = await data.listAuditLogs({ action: 'company.created' });
    if (first.status !== 'ok') throw new Error('expected ok');
    expect(first.nextCursor).not.toBeNull();
    const second = await data.listAuditLogs({ action: 'company.created', cursor: first.nextCursor });
    if (second.status !== 'ok') throw new Error('expected ok');
    const ids = [...first.rows, ...second.rows].map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const total = await db().admin.query(`SELECT count(*)::int AS n FROM public.audit_logs WHERE action = 'company.created'`);
    expect(ids).toHaveLength(total.rows[0].n);
  });

  it('admin_resolve_report: open → reviewing; powtórka ze starym statusem → STALE_STATE', async () => {
    actAs(admin);
    expect(await actions.resolveReport(report, 'reviewing', 'open')).toEqual({ ok: true });
    expect(await actions.resolveReport(report, 'reviewing', 'open')).toEqual({ ok: false, error: 'STALE_STATE' });
  });

  it('blokady poczty: lista aktywnych, zdjęcie z uzasadnieniem, filtr zdjętych z nazwą admina', async () => {
    actAs(admin);
    const active = await data.listEmailSuppressions({ q: 'odbicie_it' });
    expect(active).toMatchObject({ status: 'ok', rows: [{ id: suppression, reason: 'hard_bounce', liftedAt: null }] });
    expect(await actions.liftEmailSuppression(suppression, 'Użytkownik potwierdził adres')).toEqual({ ok: true });
    expect(await actions.liftEmailSuppression(suppression, 'Użytkownik potwierdził adres')).toEqual({ ok: false, error: 'STALE_STATE' });
    const lifted = await data.listEmailSuppressions({ status: 'lifted' });
    expect(lifted).toMatchObject({ status: 'ok', rows: [{ id: suppression, liftedByName: 'Ada Admin', liftReason: 'Użytkownik potwierdził adres' }] });
    const stillActive = await data.listEmailSuppressions();
    expect(stillActive.status === 'ok' && stillActive.rows.map((r) => r.reason)).toEqual(['complaint']);
  });

  it('VIES: odczyt firmy service_role po roli admina, zapis RPC pod sesją, wynik w szczególe', async () => {
    actAs(admin);
    expect(await actions.checkCompanyVies(viesCompany)).toMatchObject({ ok: true, saved: true, outcome: { status: 'valid', nameMatch: 'match' } });
    const detail = await data.getCompanyDetail(viesCompany);
    if (detail.status !== 'ok') throw new Error('expected ok');
    const stored = await db().admin.query('SELECT result, checked_by FROM public.company_vies_checks WHERE company_id = $1', [viesCompany]);
    expect(stored.rows[0]).toEqual({ result: 'valid', checked_by: admin.id });
    expect(JSON.stringify(detail.company.vies)).toContain('valid');
    expect(await actions.checkCompanyVies('00000000-0000-4000-8000-000000000000')).toEqual({ ok: false, error: 'NOT_FOUND' });
  });
});
