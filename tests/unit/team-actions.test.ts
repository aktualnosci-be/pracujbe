import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  inviteTeamMember,
  respondToTeamInvitation,
  revokeTeamInvitation,
  setTeamMemberActive,
  setTeamMemberRole,
} from '@/lib/actions/team';
import { createAdditionalCompany, setActiveCompany } from '@/lib/actions/company';
import { activeCompanyCookieOptions } from '@/lib/company-context';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { cookies } from 'next/headers';
import { mapTeamError, teamErrorKey } from '@/lib/team/errors';
import { hashTeamInviteToken, teamInviteTokenFromNonce } from '@/lib/team/invite-token';
import { toUserMessageKey } from '@/lib/errors';
import { assignableRoles, canManageRole, canManageTeam, canRecruit } from '@/lib/team/permissions';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));
vi.mock('next/headers', () => ({ cookies: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/company-context', async () => {
  // Reguła porównania firmy widoku z aktywną jest prawdziwa (matchExpectedCompany) — atrapa
  // podmienia tylko odczyt aktywnej firmy (cookie + członkostwa).
  const actual = await vi.importActual<typeof import('@/lib/company-context')>('@/lib/company-context');
  const getActiveCompany = vi.fn();
  return {
    ACTIVE_COMPANY_COOKIE: 'pb_active_company',
    activeCompanyCookieOptions: actual.activeCompanyCookieOptions,
    getActiveCompany,
    getExpectedActiveCompany: async (tx: never, userId: string, expected: unknown) =>
      actual.matchExpectedCompany(await getActiveCompany(tx, userId), expected),
  };
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const MEMBER = '5b3f0a4e-2f4d-4c1e-9a36-1f7b2c9d8e01';
const INVITE = '6c4f1b5e-3a5d-4d2f-8b47-2a8c3d0e9f12';
const COMPANY = '7d5a2c6f-4b6e-4e3a-9c58-3b9d4e1f0a23';

const USER = '8e6b3d7a-5c7f-4f4b-8d69-4c0e5f2a1b34';
const cookieSet = vi.fn();

/**
 * Atrapa bazy: każde RPC zespołu zwraca `data` albo rzuca błąd bazy z `error.message`.
 * `rpc` = lista wywołań RPC w kolejności [nazwa, argumenty] (tożsamość sprawdza `as`).
 */
function client(rpcResult: { data: unknown; error: { message: string } | null }, user: { id: string } | null = { id: USER }) {
  resetFakeDb(user ? { id: user.id, role: 'employer' } : null);
  const handler = () => {
    if (rpcResult.error) throw pgError('P0001', rpcResult.error.message);
    return rpcResult.data;
  };
  for (const fn of [
    'invite_company_member',
    'revoke_company_invitation',
    'set_company_member_role',
    'set_company_member_active',
    'respond_to_company_invitation',
    'create_additional_company',
  ]) {
    fakeDb.rpc(fn, handler);
  }
  const fake = fakeDb;
  return {
    get calls() {
      return fake.calls.filter((c) => c.kind === 'rpc' || c.kind === 'rpcrows');
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(cookies).mockResolvedValue({ set: cookieSet } as never);
  vi.mocked(getActiveCompany).mockResolvedValue({ activeId: COMPANY, activeRole: 'owner' } as never);
});

describe('inviteTeamMember (#403)', () => {
  it('zaprasza do AKTYWNEJ firmy znormalizowany adres z rolą', async () => {
    const db = client({ data: [{ invitation_id: INVITE, created: true }], error: null });
    expect(await inviteTeamMember({ email: '  rita@firma.be ', role: 'recruiter', locale: 'pl' }, COMPANY)).toEqual({ ok: true });
    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toMatchObject({
      name: 'invite_company_member',
      as: USER,
      args: { p_company_id: COMPANY, p_email: 'rita@firma.be', p_role: 'recruiter', p_locale: 'pl' },
    });
    // Aktywna firma czytana w tej samej transakcji (kontekst dostaje tx i UUID z sesji).
    expect(vi.mocked(getActiveCompany).mock.calls[0]?.[1]).toBe(USER);
  });

  it('KONTROLA UJEMNA: rola owner i zły e-mail nie docierają do bazy', async () => {
    const db = client({ data: null, error: null });
    expect(await inviteTeamMember({ email: 'rita@firma.be', role: 'owner' as never, locale: 'pl' }, COMPANY)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await inviteTeamMember({ email: 'bez-malpy', role: 'member', locale: 'pl' }, COMPANY)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(db.calls).toHaveLength(0);
  });

  it('mapuje błędy bazy na stabilne kody (bez technikaliów)', async () => {
    client({ data: null, error: { message: 'MEMBER_ALREADY_EXISTS' } });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY)).toEqual({
      ok: false,
      error: 'MEMBER_ALREADY_EXISTS',
    });
    client({ data: null, error: { message: 'PERMISSION_DENIED' } });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY)).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('bez sesji i bez aktywnej firmy — brak wywołania RPC', async () => {
    const anon = client({ data: null, error: null }, null);
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY)).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(anon.calls).toHaveLength(0);
    vi.mocked(getActiveCompany).mockResolvedValue({ activeId: null, activeRole: 'member' } as never);
    const noCompany = client({ data: null, error: null });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(noCompany.calls).toHaveLength(0);
  });

  it('EMP-02: formularz wyrenderowany dla innej firmy niż aktywna → ACTIVE_COMPANY_CHANGED, bez RPC', async () => {
    const OTHER = '9f7c4e8b-6d8a-4a5c-9e7a-5d1f6a3b2c45';
    const db = client({ data: [{ invitation_id: INVITE, created: true }], error: null });
    expect(await inviteTeamMember({ email: 'rita@firma.be', role: 'admin', locale: 'pl' }, OTHER)).toEqual({
      ok: false,
      error: 'ACTIVE_COMPANY_CHANGED',
    });
    expect(await inviteTeamMember({ email: 'rita@firma.be', role: 'admin', locale: 'pl' }, '' as never)).toEqual({
      ok: false,
      error: 'ACTIVE_COMPANY_CHANGED',
    });
    expect(db.calls).toHaveLength(0);
    // Kontrola: ta sama firma co widok przechodzi.
    expect(await inviteTeamMember({ email: 'rita@firma.be', role: 'admin', locale: 'pl' }, COMPANY)).toEqual({ ok: true });
    expect(db.calls).toHaveLength(1);
  });

  it('0121: język zaproszenia i token — do bazy tylko hash tokenu i nonce', async () => {
    const db = client({ data: [{ invitation_id: INVITE, created: true }], error: null });
    expect(await inviteTeamMember({ email: 'nowy@firma.be', role: 'member', locale: 'nl' }, COMPANY)).toEqual({ ok: true });
    const args = db.calls[0]?.args as Record<string, string>;
    expect(args.p_locale).toBe('nl');
    expect(args.p_signup_token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(args.p_signup_nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    // Hash = sha256(token), token = HMAC(sekret, "team-invite:" + nonce) — link odtworzy worker.
    const token = teamInviteTokenFromNonce(args.p_signup_nonce!);
    expect(token).not.toBeNull();
    expect(hashTeamInviteToken(token!)).toBe(args.p_signup_token_hash);
    expect(Object.values(args)).not.toContain(token);
    // Każde zaproszenie ma nowy token.
    await inviteTeamMember({ email: 'nowy@firma.be', role: 'member', locale: 'nl' }, COMPANY);
    expect((db.calls[1]?.args as Record<string, string>).p_signup_nonce).not.toBe(args.p_signup_nonce);
  });

  it('#1113: ponowienie z tym samym kluczem operacji = ten sam token (bez drugiego linku)', async () => {
    const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const db = client({ data: [{ invitation_id: INVITE, created: true }], error: null });
    const input = { email: 'nowy@firma.be', role: 'member', locale: 'nl' } as const;
    expect(await inviteTeamMember(input, COMPANY, KEY)).toEqual({ ok: true });
    expect(await inviteTeamMember({ ...input, email: ' Nowy@Firma.be ' }, COMPANY, KEY.toUpperCase())).toEqual({ ok: true });
    const [a, b] = db.calls.map((c) => c.args as Record<string, string>);
    expect(b!.p_signup_nonce).toBe(a!.p_signup_nonce);
    expect(b!.p_signup_token_hash).toBe(a!.p_signup_token_hash);
    expect(a!.p_signup_nonce).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(hashTeamInviteToken(teamInviteTokenFromNonce(a!.p_signup_nonce!)!)).toBe(a!.p_signup_token_hash);
  });

  it('KONTROLA UJEMNA #1113: inny klucz, inne dane operacji albo brak klucza = nowy token', async () => {
    const KEY = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const OTHER_KEY = 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const db = client({ data: [{ invitation_id: INVITE, created: true }], error: null });
    const input = { email: 'nowy@firma.be', role: 'member', locale: 'nl' } as const;
    await inviteTeamMember(input, COMPANY, KEY);
    await inviteTeamMember(input, COMPANY, OTHER_KEY);
    await inviteTeamMember({ ...input, locale: 'fr' }, COMPANY, KEY);
    await inviteTeamMember({ ...input, role: 'recruiter' }, COMPANY, KEY);
    await inviteTeamMember(input, COMPANY);
    await inviteTeamMember(input, COMPANY, 'nie-uuid');
    await inviteTeamMember(input, COMPANY, 'nie-uuid');
    const nonces = db.calls.map((c) => (c.args as Record<string, string>).p_signup_nonce);
    expect(new Set(nonces).size).toBe(nonces.length);
  });

  it('KONTROLA UJEMNA: język spoza PL/NL/FR/EN albo brak języka nie dociera do bazy', async () => {
    const db = client({ data: null, error: null });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'de' as never }, COMPANY)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member' } as never, COMPANY)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(db.calls).toHaveLength(0);
  });

  it('limit per IP i tryb demo', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    fakeSession.configured = false;
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' }, COMPANY)).toEqual({ ok: true, demo: true });
  });
});

describe('zarządzanie członkami (#403)', () => {
  it('zmiana roli i dezaktywacja idą przez RPC z id członka', async () => {
    const db = client({ data: null, error: null });
    expect(await setTeamMemberRole(MEMBER, 'recruiter')).toEqual({ ok: true });
    expect(await setTeamMemberActive(MEMBER, false)).toEqual({ ok: true });
    expect(await revokeTeamInvitation(INVITE)).toEqual({ ok: true });
    expect(db.calls.map((c) => [c.name, c.args])).toEqual([
      ['set_company_member_role', { p_member_id: MEMBER, p_role: 'recruiter' }],
      ['set_company_member_active', { p_member_id: MEMBER, p_active: false }],
      ['revoke_company_invitation', { p_invitation_id: INVITE }],
    ]);
    expect(db.calls.every((c) => c.as === USER)).toBe(true);
  });

  it('KONTROLA UJEMNA: nie-UUID i nieznana rola odrzucone przed bazą', async () => {
    const db = client({ data: null, error: null });
    expect(await setTeamMemberRole('1 or 1=1', 'member')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await setTeamMemberRole(MEMBER, 'superadmin')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await setTeamMemberActive(MEMBER, 'no' as never)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(db.calls).toHaveLength(0);
  });

  it('ostatni owner → LAST_OWNER', async () => {
    client({
      data: null,
      error: { message: 'VALIDATION_FAILED: firma musi mieć co najmniej jednego aktywnego właściciela' },
    });
    expect(await setTeamMemberRole(MEMBER, 'admin')).toEqual({ ok: false, error: 'LAST_OWNER' });
  });
});

describe('respondToTeamInvitation (#403)', () => {
  it('przyjęcie ustawia nową firmę jako aktywną', async () => {
    const db = client({ data: COMPANY, error: null });
    expect(await respondToTeamInvitation(INVITE, true)).toEqual({ ok: true });
    expect(db.calls[0]).toMatchObject({
      name: 'respond_to_company_invitation',
      args: { p_invitation_id: INVITE, p_accept: true },
    });
    expect(cookieSet).toHaveBeenCalledWith('pb_active_company', COMPANY, expect.objectContaining({ httpOnly: true }));
  });

  it('odrzucenie i błąd nie zmieniają aktywnej firmy', async () => {
    client({ data: COMPANY, error: null });
    expect(await respondToTeamInvitation(INVITE, false)).toEqual({ ok: true });
    client({ data: null, error: { message: 'NOT_FOUND' } });
    expect(await respondToTeamInvitation(INVITE, true)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe('createAdditionalCompany (#403)', () => {
  it('zakłada kolejną firmę i przełącza na nią panel', async () => {
    const db = client({ data: [{ company_id: COMPANY, created: true }], error: null });
    expect(await createAdditionalCompany({ name: 'Druga Firma', vatNumber: '' })).toEqual({ ok: true, id: COMPANY });
    // Pusty VAT → jawne null w argumencie (nie pominięty, więc nie domyślna wartość funkcji).
    expect(db.calls[0]).toMatchObject({
      name: 'create_additional_company',
      kind: 'rpcrows',
      args: { p_name: 'Druga Firma', p_vat_number: null },
    });
    expect(cookieSet).toHaveBeenCalledWith('pb_active_company', COMPANY, expect.anything());
  });

  it('limit firm → COMPANY_LIMIT_REACHED, bez zmiany aktywnej firmy', async () => {
    client({ data: null, error: { message: 'COMPANY_LIMIT_REACHED' } });
    expect(await createAdditionalCompany({ name: 'Szósta' })).toEqual({ ok: false, error: 'COMPANY_LIMIT_REACHED' });
    expect(cookieSet).not.toHaveBeenCalled();
  });
});

describe('hierarchia ról w UI = hierarchia w bazie (0086)', () => {
  it('owner zarządza wszystkimi, admin tylko recruiter/member, reszta niczym', () => {
    for (const target of ['owner', 'admin', 'recruiter', 'member']) {
      expect(canManageRole('owner', target)).toBe(true);
      expect(canManageRole('admin', target)).toBe(target === 'recruiter' || target === 'member');
      expect(canManageRole('recruiter', target)).toBe(false);
      expect(canManageRole('member', target)).toBe(false);
    }
    expect(assignableRoles('admin')).toEqual(['recruiter', 'member']);
    expect(assignableRoles('member')).toEqual([]);
    expect(canManageTeam('admin')).toBe(true);
    expect(canManageTeam('recruiter')).toBe(false);
    expect(canRecruit('recruiter')).toBe(true);
    expect(canRecruit('member')).toBe(false);
  });

  it('migracja definiuje tę samą regułę dla admina', () => {
    const sql = readFileSync(resolve(process.cwd(), 'supabase/migrations/0086_company_team.sql'), 'utf8');
    expect(sql).toMatch(/cm\.role = 'owner' or \(cm\.role = 'admin' and p_role in \('recruiter', 'member'\)\)/);
  });

  it('#867: odmowa przywrócenia wyłączonego członka — własne kody i komunikaty, nie ogólny błąd', async () => {
    client({ data: null, error: { message: 'MEMBER_REACTIVATION_DENIED' } });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'recruiter', locale: 'pl' }, COMPANY)).toEqual({
      ok: false,
      error: 'MEMBER_REACTIVATION_DENIED',
    });
    client({ data: null, error: { message: 'REACTIVATION_NOT_ALLOWED' } });
    expect(await respondToTeamInvitation(INVITE, true)).toEqual({ ok: false, error: 'REACTIVATION_NOT_ALLOWED' });
    expect(cookieSet).not.toHaveBeenCalled();
    expect(teamErrorKey('MEMBER_REACTIVATION_DENIED', toUserMessageKey)).toBe('team.error.reactivationDenied');
    expect(teamErrorKey('REACTIVATION_NOT_ALLOWED', toUserMessageKey)).toBe('team.error.reactivationNotAllowed');
    // Kontrola ujemna: zwykła odmowa uprawnień nadal mapuje się na PERMISSION_DENIED.
    expect(mapTeamError('PERMISSION_DENIED')).toBe('PERMISSION_DENIED');
  });

  it('#867: migracja 0217 sprawdza starą rolę przy zaproszeniu i przy przyjęciu', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0217_team_member_reactivation_hierarchy.sql'),
      'utf8',
    );
    expect(sql).toMatch(/company_role_manageable_by\(v_inv\.company_id, v_inv\.invited_by, v_member\.role\)/);
    expect(sql).toMatch(/before insert or update on public\.company_invitations/);
    expect(sql).toMatch(/cm\.role = 'owner' or \(cm\.role = 'admin' and p_role in \('recruiter', 'member'\)\)/);
  });

  it('kody zespołu mają własne komunikaty, pozostałe — wspólne errors.*', () => {
    expect(teamErrorKey('COMPANY_LIMIT_REACHED', toUserMessageKey)).toBe('team.error.companyLimit');
    expect(teamErrorKey('PERMISSION_DENIED', toUserMessageKey)).toBe('errors.permissionDenied');
    expect(mapTeamError('permission denied for table company_invitations')).toBe('PERMISSION_DENIED');
    expect(mapTeamError('boom')).toBe('INTERNAL');
  });
});

describe('cookie aktywnej firmy: atrybut Secure (#1109)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('helper: Secure w produkcji, bez Secure poza nią (localhost/testy); reszta atrybutów bez zmian', () => {
    vi.stubEnv('NODE_ENV', 'production');
    expect(activeCompanyCookieOptions()).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 24 * 365,
    });
    vi.stubEnv('NODE_ENV', 'development');
    expect(activeCompanyCookieOptions().secure).toBe(false);
  });

  it('wszystkie trzy miejsca zapisu (przełącznik, nowa firma, przyjęcie zaproszenia) ustawiają Secure w produkcji', async () => {
    vi.stubEnv('NODE_ENV', 'production');

    client({ data: COMPANY, error: null });
    await respondToTeamInvitation(INVITE, true);
    expect(cookieSet).toHaveBeenLastCalledWith('pb_active_company', COMPANY, expect.objectContaining({ secure: true }));

    cookieSet.mockClear();
    client({ data: [{ company_id: COMPANY, created: true }], error: null });
    await createAdditionalCompany({ name: 'Druga Firma', vatNumber: '' });
    expect(cookieSet).toHaveBeenLastCalledWith('pb_active_company', COMPANY, expect.objectContaining({ secure: true }));

    cookieSet.mockClear();
    client({ data: null, error: null });
    fakeDb.rows('company.active-membership', [{ id: 'm1' }]);
    expect(await setActiveCompany(COMPANY)).toEqual({ ok: true });
    expect(cookieSet).toHaveBeenLastCalledWith('pb_active_company', COMPANY, expect.objectContaining({ secure: true }));
  });

  it('kontrola ujemna: poza produkcją cookie nie jest Secure (przeglądarka zapisze je na http://localhost)', async () => {
    vi.stubEnv('NODE_ENV', 'test');
    client({ data: COMPANY, error: null });
    await respondToTeamInvitation(INVITE, true);
    expect(cookieSet).toHaveBeenLastCalledWith('pb_active_company', COMPANY, expect.objectContaining({ secure: false }));
  });
});
