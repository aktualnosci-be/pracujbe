import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  inviteTeamMember,
  respondToTeamInvitation,
  revokeTeamInvitation,
  setTeamMemberActive,
  setTeamMemberRole,
} from '@/lib/actions/team';
import { createAdditionalCompany } from '@/lib/actions/company';
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
vi.mock('@/lib/company-context', () => ({
  ACTIVE_COMPANY_COOKIE: 'pb_active_company',
  getActiveCompany: vi.fn(),
}));
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
    expect(await inviteTeamMember({ email: '  rita@firma.be ', role: 'recruiter', locale: 'pl' })).toEqual({ ok: true });
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
    expect(await inviteTeamMember({ email: 'rita@firma.be', role: 'owner' as never, locale: 'pl' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await inviteTeamMember({ email: 'bez-malpy', role: 'member', locale: 'pl' })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(db.calls).toHaveLength(0);
  });

  it('mapuje błędy bazy na stabilne kody (bez technikaliów)', async () => {
    client({ data: null, error: { message: 'MEMBER_ALREADY_EXISTS' } });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' })).toEqual({
      ok: false,
      error: 'MEMBER_ALREADY_EXISTS',
    });
    client({ data: null, error: { message: 'PERMISSION_DENIED' } });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
  });

  it('bez sesji i bez aktywnej firmy — brak wywołania RPC', async () => {
    const anon = client({ data: null, error: null }, null);
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(anon.calls).toHaveLength(0);
    vi.mocked(getActiveCompany).mockResolvedValue({ activeId: null, activeRole: 'member' } as never);
    const noCompany = client({ data: null, error: null });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' })).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(noCompany.calls).toHaveLength(0);
  });

  it('0121: język zaproszenia i token — do bazy tylko hash tokenu i nonce', async () => {
    const db = client({ data: [{ invitation_id: INVITE, created: true }], error: null });
    expect(await inviteTeamMember({ email: 'nowy@firma.be', role: 'member', locale: 'nl' })).toEqual({ ok: true });
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
    await inviteTeamMember({ email: 'nowy@firma.be', role: 'member', locale: 'nl' });
    expect((db.calls[1]?.args as Record<string, string>).p_signup_nonce).not.toBe(args.p_signup_nonce);
  });

  it('KONTROLA UJEMNA: język spoza PL/NL/FR/EN albo brak języka nie dociera do bazy', async () => {
    const db = client({ data: null, error: null });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'de' as never })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member' } as never)).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(db.calls).toHaveLength(0);
  });

  it('limit per IP i tryb demo', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' })).toEqual({ ok: false, error: 'RATE_LIMITED' });
    fakeSession.configured = false;
    expect(await inviteTeamMember({ email: 'a@b.be', role: 'member', locale: 'pl' })).toEqual({ ok: true, demo: true });
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

  it('kody zespołu mają własne komunikaty, pozostałe — wspólne errors.*', () => {
    expect(teamErrorKey('COMPANY_LIMIT_REACHED', toUserMessageKey)).toBe('team.error.companyLimit');
    expect(teamErrorKey('PERMISSION_DENIED', toUserMessageKey)).toBe('errors.permissionDenied');
    expect(mapTeamError('permission denied for table company_invitations')).toBe('PERMISSION_DENIED');
    expect(mapTeamError('boom')).toBe('INTERNAL');
  });
});
