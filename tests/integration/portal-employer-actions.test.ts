import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PortalIdentity } from '../../src/lib/auth/session';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

/**
 * #25 — pracodawca (firma, zespół, kreator ofert) na PostgreSQL 16: akcje i loadery wołane
 * bez zmian, transakcja z sesji (`withUserTransaction` → RLS jako authenticated). Sprawdzamy
 * idempotencję zakładania firmy, edycję tylko owner/admin (RLS + trigger), kreator szkic →
 * krok → publikacja wymagająca `verified`, recruiter+ vs member, izolację obcej firmy
 * i hierarchię ról zespołu.
 */

const cookieJar = new Map<string, string>();
vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (cookieJar.has(name) ? { name, value: cookieJar.get(name)! } : undefined),
    set: (name: string, value: string) => void cookieJar.set(name, value),
  }),
}));
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const company = await import('../../src/lib/actions/company');
const jobs = await import('../../src/lib/actions/jobs');
const team = await import('../../src/lib/actions/team');
const { importJobListing } = await import('../../src/lib/actions/job-import');
const { getMyCompany, getCompanyModerationDecisions } = await import('../../src/lib/data/company');
const { getTeamPageData, getMyTeamInvitations } = await import('../../src/lib/data/team');
const { withPortalTransaction } = await import('@/lib/db/portal');
const { execute } = await import('../../src/lib/db/sql');
const { revalidatePath } = await import('next/cache');

const STEPS: unknown[] = [
  { title: 'Magazynier nocny', category: 'warehouse', occupation: 'Magazynier' },
  { contractType: 'temporary', workingHours: '40 h', shifts: '', startImmediately: true },
  { city: 'Gandawa', region: 'Flandria', address: '', remote: false },
  { salaryMin: 16, salaryMax: 18, currency: 'EUR', salaryPeriod: 'hour' },
  { description: 'Praca na magazynie w Gandawie, zmiana nocna, stała ekipa.', responsibilities: ['Kompletacja'] },
  { requirementsMandatory: ['Praca w nocy'], mandatorySkills: ['Skaner'], minExperienceYears: 1 },
  {
    requirementsOptional: ['Wózek'],
    skills: ['Excel'],
    languages: [{ language: 'Angielski', level: 'basic' }],
    requiredCertificates: ['VCA'],
    requiresDrivingLicense: false,
    noLanguageRequired: false,
  },
  { conditions: ['Umowa'], benefits: ['Dodatek nocny'], accommodation: true, transport: false },
  { companyDescription: 'Firma A — logistyka w Gandawie.', contactEmail: 'hr@firma-a.be', applyUrl: 'https://firma-a.be/praca' },
];

const as = (id: string): PortalIdentity => ({ id, role: 'employer' });
let ownerA: string;
let ownerB: string;
let recruiterA: string;
let memberA: string;
let adminA: string;
let companyA: string;
let companyB: string;
let draftA: string;

async function admin(sql: string, values: unknown[] = []) {
  return (await realSession.db!.admin.query(sql, values)).rows;
}

async function verifyEmail(id: string) {
  await admin('UPDATE auth.users SET email_verified = true WHERE id = $1', [id]);
}

/** Zaproszenie przez akcję (owner/admin) i przyjęcie przez adresata (zweryfikowany e-mail). */
async function join(inviter: string, invitee: string, role: 'admin' | 'recruiter' | 'member') {
  actAs(as(inviter));
  expect(await team.inviteTeamMember({ email: `${invitee}@example.invalid`, role, locale: 'pl' }, companyA)).toEqual({ ok: true });
  const [inv] = await admin(`SELECT id FROM public.company_invitations
    WHERE email = $1 AND status = 'pending'`, [`${invitee}@example.invalid`]);
  actAs(as(invitee));
  expect(await team.respondToTeamInvitation(inv!['id'] as string, true)).toEqual({ ok: true });
}

beforeAll(async () => {
  realSession.db = await startPortalDb();
  const db = realSession.db;
  ownerA = await db.createUser('employer');
  ownerB = await db.createUser('employer', 'nl');
  recruiterA = await db.createUser('employer');
  memberA = await db.createUser('employer');
  adminA = await db.createUser('employer');
  for (const id of [ownerA, ownerB, recruiterA, memberA, adminA]) await verifyEmail(id);
});

beforeEach(() => cookieJar.clear());

afterAll(async () => { await realSession.db?.stop(); });

describe('firma (#25)', () => {
  it('createCompany: pierwsza firma z VAT, powtórka zwraca tę samą (idempotencja)', async () => {
    actAs(as(ownerA));
    const first = await company.createCompany({ name: 'Firma A', vatNumber: 'BE0123456789' });
    expect(first).toMatchObject({ ok: true });
    companyA = (first as { id: string }).id;
    expect(await company.createCompany({ name: 'Firma A bis' })).toEqual({ ok: true, id: companyA });
    const rows = await admin('SELECT name, vat_number, status FROM public.companies WHERE id = $1', [companyA]);
    expect(rows).toEqual([{ name: 'Firma A', vat_number: 'BE0123456789', status: 'unverified' }]);
    expect(await admin('SELECT count(*)::int AS n FROM public.company_members WHERE profile_id = $1', [ownerA]))
      .toEqual([{ n: 1 }]);

    actAs(as(ownerB));
    const b = await company.createCompany({ name: 'Firma B' });
    companyB = (b as { id: string }).id;
    expect(companyB).not.toBe(companyA);
  });

  it('createCompany: gość i kandydat nie zakładają firmy', async () => {
    actAs(null);
    expect(await company.createCompany({ name: 'Gość' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    const candidate = await realSession.db!.createUser('candidate');
    actAs({ id: candidate, role: 'candidate' });
    expect(await company.createCompany({ name: 'Kandydat' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('getMyCompany: własna firma z canEdit; inny pracodawca widzi tylko swoją', async () => {
    actAs(as(ownerA));
    expect(await getMyCompany()).toMatchObject({
      status: 'ok',
      company: { id: companyA, name: 'Firma A', status: 'unverified', vatNumber: 'BE0123456789', canEdit: true },
    });
    actAs(as(ownerB));
    expect(await getMyCompany()).toMatchObject({ status: 'ok', company: { id: companyB } });
    // Podrzucone cookie obcej firmy jest ignorowane (walidacja względem członkostw).
    cookieJar.set('pb_active_company', companyA);
    expect(await getMyCompany()).toMatchObject({ status: 'ok', company: { id: companyB } });
    const fresh = await realSession.db!.createUser('employer');
    actAs(as(fresh));
    expect(await getMyCompany()).toEqual({ status: 'ok', company: null });
  });

  it('zespół: zaproszenia i przyjęcie wg ról (recruiter, member, admin)', async () => {
    await join(ownerA, recruiterA, 'recruiter');
    await join(ownerA, memberA, 'member');
    await join(ownerA, adminA, 'admin');
    const roles = await admin(`SELECT profile_id, role FROM public.company_members WHERE company_id = $1`, [companyA]);
    expect(new Map(roles.map((r) => [r['profile_id'], r['role']]))).toEqual(new Map([
      [ownerA, 'owner'], [recruiterA, 'recruiter'], [memberA, 'member'], [adminA, 'admin'],
    ]));
    // Przyjęcie ustawia nową firmę jako aktywną.
    expect(cookieJar.get('pb_active_company')).toBe(companyA);
  });

  it('updateCompany: owner/admin zapisują; member i recruiter nie (akcja + RLS w bazie)', async () => {
    actAs(as(adminA));
    expect(await company.updateCompany(companyA, { name: 'Firma A Logistics' })).toEqual({ ok: true });
    actAs(as(memberA));
    expect(await company.updateCompany(companyA, { name: 'Przejęta' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(as(recruiterA));
    expect(await company.updateCompany(companyA, { name: 'Przejęta' })).toEqual({ ok: false, error: 'PERMISSION_DENIED' });

    // Ta sama zmiana z pominięciem strażnika akcji: RLS `companies_update_member` (0040) nie
    // przepuszcza membera ani obcej firmy — zero wierszy.
    for (const [user, target] of [[memberA, companyA], [ownerB, companyA]] as const) {
      const { rowCount } = await withPortalTransaction(as(user), (tx) =>
        execute(tx, 'test.company-update', "UPDATE public.companies SET name = 'X' WHERE id = $1", [target]));
      expect(rowCount).toBe(0);
    }
    // Status firmy nietykalny także dla ownera (trigger protect_company_verification).
    await expect(withPortalTransaction(as(ownerA), (tx) =>
      execute(tx, 'test.company-status', "UPDATE public.companies SET status = 'verified' WHERE id = $1", [companyA])))
      .rejects.toMatchObject({ code: '42501' });
    expect(await admin('SELECT name, status FROM public.companies WHERE id = $1', [companyA]))
      .toEqual([{ name: 'Firma A Logistics', status: 'unverified' }]);
  });

  it('updateCompany: zmiana nazwy zweryfikowanej firmy wraca do weryfikacji; pusty VAT czyści', async () => {
    await admin("UPDATE public.companies SET status = 'verified', verified_at = now() WHERE id = $1", [companyB]);
    actAs(as(ownerB));
    expect(await company.updateCompany(companyB, { name: 'Firma B Nowa' })).toEqual({ ok: true, reverificationRequired: true });
    await admin("UPDATE public.companies SET status = 'verified', verified_at = now(), vat_number = 'BE0999999999' WHERE id = $1", [companyB]);
    expect(await company.updateCompany(companyB, { vatNumber: '' })).toEqual({ ok: true, reverificationRequired: true });
    expect(await admin('SELECT name, vat_number FROM public.companies WHERE id = $1', [companyB]))
      .toEqual([{ name: 'Firma B Nowa', vat_number: null }]);
    await admin("UPDATE public.companies SET status = 'verified', verified_at = now() WHERE id = $1", [companyB]);
  });

  it('requestCompanyReverification: tylko odrzucona firma i tylko owner/admin', async () => {
    actAs(as(ownerA));
    expect(await company.requestCompanyReverification(companyA)).toEqual({ ok: false, error: 'INVALID_TRANSITION' });
    await admin("UPDATE public.companies SET status = 'rejected' WHERE id = $1", [companyA]);
    actAs(as(memberA));
    expect(await company.requestCompanyReverification(companyA)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    actAs(as(ownerA));
    expect(await company.requestCompanyReverification(companyA)).toEqual({ ok: true });
    expect(await admin('SELECT status FROM public.companies WHERE id = $1', [companyA])).toEqual([{ status: 'pending' }]);
  });

  it('setActiveCompany: tylko firma z aktywnym członkostwem; createAdditionalCompany przełącza', async () => {
    actAs(as(ownerA));
    expect(await company.setActiveCompany(companyB)).toEqual({ ok: false });
    expect(cookieJar.has('pb_active_company')).toBe(false);
    expect(await company.setActiveCompany(companyA)).toEqual({ ok: true });
    expect(cookieJar.get('pb_active_company')).toBe(companyA);

    const second = await company.createAdditionalCompany({ name: 'Firma A Druga' });
    expect(second).toMatchObject({ ok: true });
    const secondId = (second as { id: string }).id;
    expect(cookieJar.get('pb_active_company')).toBe(secondId);
    expect(await getMyCompany()).toMatchObject({ company: { id: secondId, canEdit: true } });
    // Powrót do firmy A na dalsze testy.
    expect(await company.setActiveCompany(companyA)).toEqual({ ok: true });
    cookieJar.clear();
  });

  it('#801: aktywna firma w cookie (przełączona w innej karcie) nie przechwytuje zapisu formularza dla innej firmy', async () => {
    actAs(as(ownerA));
    expect(await company.setActiveCompany(companyA)).toEqual({ ok: true });
    const second = await company.createAdditionalCompany({ name: 'Firma A Trzecia' });
    expect(second).toMatchObject({ ok: true });
    const secondId = (second as { id: string }).id;
    // createAdditionalCompany przełącza aktywną firmę (jak przełączenie w innej karcie).
    expect(cookieJar.get('pb_active_company')).toBe(secondId);

    // Formularz był otwarty dla companyA (przed przełączeniem) — zapis musi trafić do
    // companyA z formularza, NIE do aktywnej firmy wskazanej teraz przez cookie.
    expect(await company.updateCompany(companyA, { name: 'Firma A Po Przełączeniu' })).toEqual({ ok: true });
    expect(await admin('SELECT name FROM public.companies WHERE id = $1', [companyA]))
      .toEqual([{ name: 'Firma A Po Przełączeniu' }]);
    // Aktywna firma w cookie (secondId) pozostaje nietknięta.
    expect(await admin('SELECT name FROM public.companies WHERE id = $1', [secondId]))
      .toEqual([{ name: 'Firma A Trzecia' }]);

    // Sprzątanie: powrót do companyA jako aktywnej.
    expect(await company.setActiveCompany(companyA)).toEqual({ ok: true });
    cookieJar.clear();
  });

  it('EMP-02: akcje z widoku firmy A po przełączeniu aktywnej firmy (inna karta) nie piszą do nowej', async () => {
    actAs(as(ownerA));
    const [other] = await admin(`SELECT m.company_id FROM public.company_members m
      WHERE m.profile_id = $1 AND m.company_id <> $2 AND m.is_active ORDER BY m.created_at LIMIT 1`, [ownerA, companyA]);
    const otherId = other!['company_id'] as string;
    expect(await company.setActiveCompany(otherId)).toEqual({ ok: true });
    const jobsBefore = await admin('SELECT count(*)::int AS n FROM public.jobs WHERE company_id IN ($1, $2)', [companyA, otherId]);

    // Kreator, zaproszenie i ponowna weryfikacja wyrenderowane dla companyA.
    expect(await jobs.createJobDraft('pl', companyA)).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    expect(await team.inviteTeamMember({ email: 'emp02@example.invalid', role: 'admin', locale: 'pl' }, companyA))
      .toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    expect(await company.requestCompanyReverification(companyA)).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });

    expect(await admin('SELECT count(*)::int AS n FROM public.jobs WHERE company_id IN ($1, $2)', [companyA, otherId]))
      .toEqual(jobsBefore);
    expect(await admin("SELECT company_id FROM public.company_invitations WHERE email = 'emp02@example.invalid'"))
      .toEqual([]);

    // Kontrola: widok nowej aktywnej firmy tworzy szkic właśnie w niej.
    const draft = await jobs.createJobDraft('pl', otherId);
    expect(draft).toMatchObject({ ok: true });
    expect(await admin('SELECT company_id FROM public.jobs WHERE id = $1', [(draft as { id: string }).id]))
      .toEqual([{ company_id: otherId }]);
    await admin('DELETE FROM public.jobs WHERE id = $1', [(draft as { id: string }).id]);

    expect(await company.setActiveCompany(companyA)).toEqual({ ok: true });
    cookieJar.clear();
  });

  it('decyzje moderacyjne: odczyt RPC pod sesją (owner — pusta lista, gość — błąd)', async () => {
    actAs(as(ownerA));
    expect(await getCompanyModerationDecisions(companyA)).toEqual({ status: 'ok', decisions: [] });
    actAs(null);
    expect(await getCompanyModerationDecisions(companyA)).toEqual({ status: 'error' });
  });
});

describe('kreator ofert (#25)', () => {
  it('member nie tworzy szkicu (RLS insert recruiter+); recruiter tworzy szkic aktywnej firmy', async () => {
    actAs(as(memberA));
    expect(await jobs.createJobDraft('pl', companyA)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });

    actAs(as(recruiterA));
    const draft = await jobs.createJobDraft('nl', companyA);
    expect(draft).toMatchObject({ ok: true });
    draftA = (draft as { id: string }).id;
    expect(await admin('SELECT company_id, created_by, status, default_locale FROM public.jobs WHERE id = $1', [draftA]))
      .toEqual([{ company_id: companyA, created_by: recruiterA, status: 'draft', default_locale: 'nl' }]);
  });

  it('updateJobDraft: każdy krok jednym RPC save_job_draft; relacje zapisane', async () => {
    actAs(as(recruiterA));
    // #1070: kreator odsyła wersję z poprzedniej odpowiedzi — łańcuch wersji przez wszystkie kroki.
    let version: string | undefined;
    for (let step = 1; step <= 9; step += 1) {
      const res = await jobs.updateJobDraft(draftA, step, STEPS[step - 1], version);
      expect(res, `krok ${step}`).toMatchObject({ ok: true, version: expect.any(String) });
      const next = (res as { version: string }).version;
      if (version) expect(Date.parse(next), `krok ${step}: wersja rośnie`).toBeGreaterThanOrEqual(Date.parse(version));
      expect(next).not.toBe(version);
      version = next;
    }
    expect(await admin('SELECT (updated_at = $2::timestamptz) AS same FROM public.jobs WHERE id = $1', [draftA, version]))
      .toEqual([{ same: true }]);
    expect(await admin('SELECT title, city FROM public.jobs WHERE id = $1', [draftA]))
      .toEqual([{ title: 'Magazynier nocny', city: 'Gandawa' }]);
    expect(await admin('SELECT count(*)::int AS n FROM public.job_languages WHERE job_id = $1', [draftA]))
      .toEqual([{ n: 1 }]);
    // Powtórzenie kroku (replace-all) nie dubluje relacji.
    expect(await jobs.updateJobDraft(draftA, 7, STEPS[6], version)).toMatchObject({ ok: true });
    expect(await admin('SELECT count(*)::int AS n FROM public.job_certificates WHERE job_id = $1', [draftA]))
      .toEqual([{ n: 1 }]);
  });

  it('#1070: token wersji szkicu — stara wersja (druga karta) = JOB_EDIT_CONFLICT, równoległe zapisy nie nadpisują', async () => {
    actAs(as(recruiterA));
    // Wersja tak, jak widzi ją loader (`to_json` → ISO z pełną precyzją).
    const versionRow = await realSession.db!.admin.query<{ v: string }>(
      'SELECT to_json(updated_at) #>> \'{}\' AS v FROM public.jobs WHERE id = $1', [draftA]);
    const v0 = versionRow.rows[0]!.v;
    const titled = (title: string) => ({ ...(STEPS[0] as object), title });

    // Karta A zapisuje z aktualną wersją, karta B nadal trzyma poprzednią.
    const a = await jobs.updateJobDraft(draftA, 1, titled('Karta A'), v0);
    expect(a).toMatchObject({ ok: true });
    const vA = (a as { version: string }).version;
    // Kontrola ujemna: stara wersja NIE przechodzi i niczego nie zmienia (kolumny ani relacje).
    expect(await jobs.updateJobDraft(draftA, 1, titled('Karta B'), v0)).toEqual({ ok: false, error: 'JOB_EDIT_CONFLICT' });
    expect(await jobs.updateJobDraft(draftA, 7, { ...(STEPS[6] as object), skills: ['Nadpisana'] }, v0))
      .toEqual({ ok: false, error: 'JOB_EDIT_CONFLICT' });
    expect(await admin('SELECT title FROM public.jobs WHERE id = $1', [draftA])).toEqual([{ title: 'Karta A' }]);
    expect(await admin('SELECT skill_label FROM public.job_skills WHERE job_id = $1 AND NOT is_mandatory', [draftA]))
      .toEqual([{ skill_label: 'Excel' }]);

    // Po wczytaniu aktualnej wersji karta B zapisuje normalnie.
    const b = await jobs.updateJobDraft(draftA, 1, titled('Karta B'), vA);
    expect(b).toMatchObject({ ok: true });
    const vB = (b as { version: string }).version;

    // Dwa RÓWNOLEGŁE zapisy z tą samą wersją: dokładnie jeden wygrywa, drugi to konflikt.
    const results = await Promise.all([
      jobs.updateJobDraft(draftA, 1, titled('Równoległy 1'), vB),
      jobs.updateJobDraft(draftA, 1, titled('Równoległy 2'), vB),
    ]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'JOB_EDIT_CONFLICT' }]);
    const winner = results.findIndex((r) => r.ok) + 1;
    expect(await admin('SELECT title FROM public.jobs WHERE id = $1', [draftA])).toEqual([{ title: `Równoległy ${winner}` }]);

    // Nieprawidłowy token odrzucony przed bazą; zapis bez tokenu (świeży szkic) nadal działa.
    expect(await jobs.updateJobDraft(draftA, 1, titled('X'), 'to-nie-data')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await jobs.updateJobDraft(draftA, 1, STEPS[0])).toMatchObject({ ok: true });
  });

  it('obca firma i member nie edytują ani nie publikują cudzej oferty', async () => {
    actAs(as(ownerB));
    expect(await jobs.updateJobDraft(draftA, 1, { ...(STEPS[0] as object), title: 'Przejęta oferta' }))
      .toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await jobs.publishJob(draftA)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await jobs.setJobStatus(draftA, 'close')).toMatchObject({ ok: false });
    actAs(as(memberA));
    expect(await jobs.updateJobDraft(draftA, 1, { ...(STEPS[0] as object), title: 'Przejęta oferta' }))
      .toMatchObject({ ok: false });
    expect(await jobs.publishJob(draftA)).toMatchObject({ ok: false });
    expect(await admin('SELECT title, status FROM public.jobs WHERE id = $1', [draftA]))
      .toEqual([{ title: 'Magazynier nocny', status: 'draft' }]);
  });

  it('publishJob wymaga firmy verified; po weryfikacji publikuje, kreator nie edytuje już szkicu', async () => {
    actAs(as(recruiterA));
    expect(await jobs.publishJob(draftA)).toEqual({ ok: false, error: 'COMPANY_NOT_VERIFIED' });
    await admin("UPDATE public.companies SET status = 'verified', verified_at = now() WHERE id = $1", [companyA]);
    expect(await jobs.publishJob(draftA)).toEqual({ ok: true });
    const [job] = await admin('SELECT status, slug FROM public.jobs WHERE id = $1', [draftA]);
    expect(job).toMatchObject({ status: 'active' });
    expect(String(job!['slug'])).toMatch(/^magazynier-nocny-[0-9a-f]{8}$/);
    expect(await jobs.updateJobDraft(draftA, 1, STEPS[0])).toEqual({ ok: false, error: 'JOB_NOT_DRAFT' });
    expect(await jobs.publishJob(draftA)).toMatchObject({ ok: false });
  });

  it('updatePublishedJob: poprawka całości z CAS; obca firma odrzucona', async () => {
    actAs(as(recruiterA));
    const steps = [...STEPS];
    steps[0] = { ...(STEPS[0] as object), title: 'Magazynier nocny – Gandawa' };
    const saved = await jobs.updatePublishedJob(draftA, steps, null);
    expect(saved).toMatchObject({ ok: true });
    const { updatedAt } = saved as { updatedAt: string };
    expect(await admin('SELECT title, status FROM public.jobs WHERE id = $1', [draftA]))
      .toEqual([{ title: 'Magazynier nocny – Gandawa', status: 'active' }]);
    // Stara wersja → konflikt (CAS po updated_at, pełna precyzja znacznika).
    expect(await jobs.updatePublishedJob(draftA, STEPS, '2020-01-01T00:00:00Z'))
      .toEqual({ ok: false, error: 'JOB_EDIT_CONFLICT' });
    expect(await jobs.updatePublishedJob(draftA, STEPS, updatedAt)).toMatchObject({ ok: true });

    actAs(as(ownerB));
    expect(await jobs.updatePublishedJob(draftA, STEPS, null)).toMatchObject({ ok: false });
  });

  it('setJobStatus: cykl życia przez RPC (recruiter+), member bez prawa', async () => {
    actAs(as(memberA));
    expect(await jobs.setJobStatus(draftA, 'pause')).toMatchObject({ ok: false });
    actAs(as(recruiterA));
    expect(await jobs.setJobStatus(draftA, 'pause')).toEqual({ ok: true, status: 'paused' });
    expect(await jobs.setJobStatus(draftA, 'resume')).toEqual({ ok: true, status: 'active' });
  });

  it('szkic: ten sam klucz operacji = ten sam szkic; obcy klucz nie zwraca cudzego (#1099 EMP-05)', async () => {
    actAs(as(recruiterA));
    const key = '6f1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f';
    const first = await jobs.createJobDraft('pl', companyA, key);
    expect(first).toMatchObject({ ok: true });
    const id = (first as { id: string }).id;
    const before = await admin('SELECT count(*)::int AS n FROM public.jobs WHERE company_id = $1', [companyA]);
    // Ponowienie po utraconej odpowiedzi / podwójne kliknięcie: ten sam szkic, bez nowego wiersza.
    expect(await jobs.createJobDraft('pl', companyA, key)).toEqual({ ok: true, id });
    expect(await admin('SELECT count(*)::int AS n FROM public.jobs WHERE company_id = $1', [companyA])).toEqual(before);
    // Kontrola ujemna: nowy klucz albo brak klucza = nowy szkic (nie sklejamy różnych operacji).
    const other = await jobs.createJobDraft('pl', companyA, '7a1c2d3e-4a5b-4c6d-8e7f-0a1b2c3d4e5f');
    expect(other).toMatchObject({ ok: true });
    expect((other as { id: string }).id).not.toBe(id);
    const noKey = await jobs.createJobDraft('pl', companyA);
    expect((noKey as { id: string }).id).not.toBe(id);
    // Cudzy klucz (inna firma, ten sam UUID) nie wydaje cudzego szkicu.
    actAs(as(ownerB));
    expect(await jobs.createJobDraft('pl', companyB, key)).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('język ogłoszenia (#1048): zmiana w szkicu przenosi treść i wymagania; brak zmiany nic nie rusza', async () => {
    actAs(as(recruiterA));
    const created = await jobs.createJobDraft('pl', companyA);
    const id = (created as { id: string }).id;
    for (const step of [1, 5, 6]) {
      expect(await jobs.updateJobDraft(id, step, STEPS[step - 1]), `krok ${step}`).toEqual({ ok: true });
    }
    const langs = async (table: string) =>
      (await admin(`SELECT DISTINCT locale FROM public.${table} WHERE job_id = $1 ORDER BY 1`, [id])).map((r) => r['locale']);
    expect(await langs('job_translations')).toEqual(['pl']);
    expect(await langs('job_requirements')).toEqual(['pl']);

    // Ten sam język w kroku 1 = bez zmian.
    expect(await jobs.updateJobDraft(id, 1, { ...(STEPS[0] as object), contentLocale: 'pl' })).toEqual({ ok: true });
    expect(await langs('job_translations')).toEqual(['pl']);

    // Zmiana na nl: default_locale i cała dotychczasowa treść w nl, nic w pl.
    expect(await jobs.updateJobDraft(id, 1, { ...(STEPS[0] as object), contentLocale: 'nl' })).toEqual({ ok: true });
    expect(await admin('SELECT default_locale FROM public.jobs WHERE id = $1', [id])).toEqual([{ default_locale: 'nl' }]);
    expect(await langs('job_translations')).toEqual(['nl']);
    expect(await langs('job_requirements')).toEqual(['nl']);
    // Kolejny zapis treści trafia do nl — bez osieroconego kompletu w pl.
    expect(await jobs.updateJobDraft(id, 5, STEPS[4])).toEqual({ ok: true });
    expect(await langs('job_translations')).toEqual(['nl']);

    // Kontrola ujemna: sama zmiana kolumny (bez przeniesienia) zostawia dwa języki — właśnie to
    // zapobiega `setDraftContentLocale`.
    await admin("UPDATE public.jobs SET default_locale = 'fr' WHERE id = $1", [id]);
    expect(await jobs.updateJobDraft(id, 5, STEPS[4])).toEqual({ ok: true });
    expect(await langs('job_translations')).toEqual(['fr', 'nl']);

    // Nieobsługiwany język odrzucony walidacją, obca firma nie zmienia języka.
    expect(await jobs.updateJobDraft(id, 1, { ...(STEPS[0] as object), contentLocale: 'de' }))
      .toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    actAs(as(ownerB));
    expect(await jobs.updateJobDraft(id, 1, { ...(STEPS[0] as object), contentLocale: 'en' }))
      .toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await admin('SELECT default_locale FROM public.jobs WHERE id = $1', [id])).toEqual([{ default_locale: 'fr' }]);
  });

  it('deleteJobDraft (#1099 EMP-04): recruiter usuwa szkic; member, obca firma i opublikowana oferta nie', async () => {
    actAs(as(recruiterA));
    const created = await jobs.createJobDraft('pl', companyA);
    const id = (created as { id: string }).id;

    // Member nie widzi szkiców (RLS) albo nie ma prawa zapisu — w obu przypadkach nic się nie zmienia.
    actAs(as(memberA));
    expect(await jobs.deleteJobDraft(id)).toMatchObject({ ok: false });
    actAs(as(ownerB));
    expect(await jobs.deleteJobDraft(id)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await admin('SELECT deleted_at FROM public.jobs WHERE id = $1', [id])).toEqual([{ deleted_at: null }]);

    actAs(as(recruiterA));
    expect(await jobs.deleteJobDraft(id)).toEqual({ ok: true });
    const [row] = await admin('SELECT deleted_at FROM public.jobs WHERE id = $1', [id]);
    expect(row!['deleted_at']).not.toBeNull();
    // Ponowienie na już usuniętym szkicu.
    expect(await jobs.deleteJobDraft(id)).toEqual({ ok: false, error: 'NOT_FOUND' });
    // Opublikowanej oferty nie usuwa się.
    expect(await jobs.deleteJobDraft(draftA)).toEqual({ ok: false, error: 'JOB_NOT_DRAFT' });
    expect(await admin('SELECT deleted_at FROM public.jobs WHERE id = $1', [draftA])).toEqual([{ deleted_at: null }]);
  });

  it('updatePublishedJob unieważnia stronę główną i landingi, nie tylko szczegół (#1099 EMP-06)', async () => {
    actAs(as(recruiterA));
    vi.mocked(revalidatePath).mockClear();
    expect(await jobs.updatePublishedJob(draftA, STEPS, null)).toMatchObject({ ok: true });
    const paths = vi.mocked(revalidatePath).mock.calls.map(([path]) => path);
    expect(paths).toEqual(expect.arrayContaining([
      '/[locale]',
      '/[locale]/oferty-pracy/[slug]',
      '/[locale]/praca/kategoria/[category]',
      '/[locale]/praca/miasto/[city]',
    ]));
  });

  it('importJobListing (atrapa AI): kontekst firmy pod sesją, zapis wyłącznie do szkicu', async () => {
    process.env.AI_JOB_IMPORT_ENABLED = '1';
    process.env.AI_JOB_IMPORT_PROVIDER = 'fixture';
    try {
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
      const form = (companyId: string = companyA) => {
        const fd = new FormData();
        fd.set('mode', 'image');
        fd.set('file', new File([Buffer.from(png)], 'ad.png', { type: 'image/png' }));
        fd.set('companyId', companyId);
        return fd;
      };
      actAs(as(memberA));
      expect(await importJobListing(form(), 'nl')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });

      actAs(as(recruiterA));
      // EMP-02: kreator wyrenderowany dla innej firmy niż aktywna — bez importu i bez szkicu.
      expect(await importJobListing(form(companyB), 'nl')).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
      const res = await importJobListing(form(), 'nl');
      expect(res).toMatchObject({ ok: true });
      const { jobId, savedSteps } = res as { jobId: string; savedSteps: number[] };
      expect(savedSteps.length).toBeGreaterThan(0);
      expect(await admin('SELECT company_id, status, title FROM public.jobs WHERE id = $1', [jobId]))
        .toEqual([{ company_id: companyA, status: 'draft', title: 'Orderpicker magazijn (m/v/x)' }]);
    } finally {
      delete process.env.AI_JOB_IMPORT_ENABLED;
      delete process.env.AI_JOB_IMPORT_PROVIDER;
    }
  });
});

describe('zespół — hierarchia ról (#25)', () => {
  const memberRow = async (profile: string) =>
    (await admin('SELECT id FROM public.company_members WHERE company_id = $1 AND profile_id = $2', [companyA, profile]))[0]!['id'] as string;

  it('getTeamPageData: owner widzi zespół i zaproszenia; member — tylko własną rolę', async () => {
    actAs(as(ownerA));
    expect(await team.inviteTeamMember({ email: 'nowa@example.invalid', role: 'member', locale: 'pl' }, companyA)).toEqual({ ok: true });
    // Powtórka zaproszenia na ten sam adres — idempotentnie jedno oczekujące.
    expect(await team.inviteTeamMember({ email: 'nowa@example.invalid', role: 'member', locale: 'pl' }, companyA)).toEqual({ ok: true });
    const data = await getTeamPageData();
    expect(data).toMatchObject({ status: 'ok', demo: false, activeRole: 'owner' });
    if (data.status !== 'ok') return;
    expect(data.members?.map((m) => m.role).sort()).toEqual(['admin', 'member', 'owner', 'recruiter']);
    expect(data.members?.find((m) => m.isSelf)?.role).toBe('owner');
    expect(data.invitations.map((i) => i.email)).toEqual(['nowa@example.invalid']);

    actAs(as(memberA));
    expect(await getTeamPageData()).toMatchObject({ status: 'ok', activeRole: 'member', members: null, invitations: [] });
    // Obca firma nie widzi zespołu A.
    actAs(as(ownerB));
    const b = await getTeamPageData();
    expect(b.status === 'ok' && b.members?.map((m) => m.role)).toEqual(['owner']);
  });

  it('getMyTeamInvitations: adresat widzi zaproszenie, inni nie', async () => {
    const invitee = await realSession.db!.createUser('employer');
    await verifyEmail(invitee);
    actAs(as(ownerB));
    expect(await team.inviteTeamMember({ email: `${invitee}@example.invalid`, role: 'recruiter', locale: 'pl' }, companyB)).toEqual({ ok: true });
    actAs(as(invitee));
    expect(await getMyTeamInvitations()).toMatchObject({
      status: 'ok', invitations: [{ companyName: 'Firma B Nowa', role: 'recruiter' }],
    });
    actAs(as(ownerA));
    expect(await getMyTeamInvitations()).toEqual({ status: 'ok', invitations: [] });
    const [inv] = await admin('SELECT id FROM public.company_invitations WHERE email = $1', [`${invitee}@example.invalid`]);
    // Cudze zaproszenie nie do przyjęcia; odrzucenie przez adresata działa.
    expect(await team.respondToTeamInvitation(inv!['id'] as string, true)).toEqual({ ok: false, error: 'NOT_FOUND' });
    actAs(as(invitee));
    expect(await team.respondToTeamInvitation(inv!['id'] as string, false)).toEqual({ ok: true });
  });

  it('admin zarządza recruiter/member, nie ownerem ani rolą admin; member niczym', async () => {
    const recruiterRow = await memberRow(recruiterA);
    const ownerRow = await memberRow(ownerA);
    actAs(as(adminA));
    expect(await team.setTeamMemberRole(recruiterRow, 'member')).toEqual({ ok: true });
    expect(await team.setTeamMemberRole(recruiterRow, 'admin')).toMatchObject({ ok: false });
    expect(await team.setTeamMemberActive(ownerRow, false)).toMatchObject({ ok: false });
    expect(await team.inviteTeamMember({ email: 'adm@example.invalid', role: 'admin', locale: 'pl' }, companyA)).toMatchObject({ ok: false });
    actAs(as(memberA));
    // RPC nie ujawnia członków komuś bez prawa zarządzania (NOT_FOUND), stan bez zmian.
    expect(await team.setTeamMemberRole(recruiterRow, 'recruiter')).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(await admin('SELECT role FROM public.company_members WHERE id = $1', [recruiterRow])).toEqual([{ role: 'member' }]);
    actAs(as(ownerA));
    expect(await team.setTeamMemberRole(recruiterRow, 'recruiter')).toEqual({ ok: true });
    expect(await admin('SELECT role FROM public.company_members WHERE id = $1', [recruiterRow])).toEqual([{ role: 'recruiter' }]);
  });

  it('owner nie odbiera dostępu sobie jako ostatniemu ownerowi; odebranie i przywrócenie membera', async () => {
    const ownerRow = await memberRow(ownerA);
    const memberRowId = await memberRow(memberA);
    actAs(as(ownerA));
    expect(await team.setTeamMemberActive(ownerRow, false)).toMatchObject({ ok: false });
    expect(await team.setTeamMemberActive(memberRowId, false)).toEqual({ ok: true });
    actAs(as(memberA));
    expect(await getMyCompany()).toEqual({ status: 'ok', company: null });
    actAs(as(ownerA));
    expect(await team.setTeamMemberActive(memberRowId, true)).toEqual({ ok: true });
  });

  it('revokeTeamInvitation: owner cofa, obca firma nie', async () => {
    const [inv] = await admin("SELECT id FROM public.company_invitations WHERE email = 'nowa@example.invalid'");
    actAs(as(ownerB));
    expect(await team.revokeTeamInvitation(inv!['id'] as string)).toMatchObject({ ok: false });
    actAs(as(ownerA));
    expect(await team.revokeTeamInvitation(inv!['id'] as string)).toEqual({ ok: true });
    expect(await admin('SELECT status FROM public.company_invitations WHERE id = $1', [inv!['id']]))
      .toEqual([{ status: 'revoked' }]);
  });
});
