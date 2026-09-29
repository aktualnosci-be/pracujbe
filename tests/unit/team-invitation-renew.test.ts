import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renewTeamInvitation } from '@/lib/actions/team';
import { getActiveCompany } from '@/lib/company-context';
import { checkRateLimit } from '@/lib/rate-limit';
import { hashTeamInviteToken, teamInviteTokenFromNonce } from '@/lib/team/invite-token';
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
    getActiveCompany,
    getExpectedActiveCompany: async (tx: never, userId: string, expected: unknown) =>
      actual.matchExpectedCompany(await getActiveCompany(tx, userId), expected),
  };
});
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn() }));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

/**
 * „Odnów zaproszenie” (0179): klient podaje tylko id; adres, rolę i język akcja bierze
 * z `get_company_invitations` AKTYWNEJ firmy i woła ten sam `invite_company_member` co
 * zaproszenie — z nowym tokenem linku rejestracji.
 */

const USER = '8e6b3d7a-5c7f-4f4b-8d69-4c0e5f2a1b34';
const COMPANY = '7d5a2c6f-4b6e-4e3a-9c58-3b9d4e1f0a23';
const INVITE = '6c4f1b5e-3a5d-4d2f-8b47-2a8c3d0e9f12';
const OTHER = '9f7c4e8b-6d8a-4a5c-9e70-5d1f6a3b2c45';

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    invitation_id: INVITE,
    email: 'rita@firma.be',
    role: 'recruiter',
    expires_at: '2026-10-01T10:00:00.000Z',
    created_at: '2026-09-17T10:00:00.000Z',
    locale: 'fr',
    inviter_name: 'Olga Owner',
    ...overrides,
  };
}

function setup(rows: unknown[], inviteError: string | null = null) {
  resetFakeDb({ id: USER, role: 'employer' });
  fakeDb.rpc('get_company_invitations', () => rows);
  fakeDb.rpc('invite_company_member', () => {
    if (inviteError) throw pgError('P0001', inviteError);
    return [{ invitation_id: INVITE, created: false }];
  });
  return {
    get calls() {
      return fakeDb.calls.filter((c) => c.kind === 'rpc' || c.kind === 'rpcrows');
    },
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb({ id: USER, role: 'employer' });
  vi.mocked(checkRateLimit).mockResolvedValue(true);
  vi.mocked(getActiveCompany).mockResolvedValue({ activeId: COMPANY, activeRole: 'owner' } as never);
});

describe('renewTeamInvitation (0179)', () => {
  it('odnawia zaproszenie adresem, rolą i JĘZYKIEM z bazy, z nowym tokenem', async () => {
    const db = setup([pendingRow()]);
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: true });
    expect(db.calls.map((c) => c.name)).toEqual(['get_company_invitations', 'invite_company_member']);
    expect(db.calls[0]).toMatchObject({ as: USER, args: { p_company_id: COMPANY } });
    const args = db.calls[1]?.args as Record<string, string>;
    expect(args).toMatchObject({
      p_company_id: COMPANY,
      p_email: 'rita@firma.be',
      p_role: 'recruiter',
      p_locale: 'fr',
    });
    const token = teamInviteTokenFromNonce(args.p_signup_nonce!);
    expect(token).not.toBeNull();
    expect(hashTeamInviteToken(token!)).toBe(args.p_signup_token_hash);
    expect(Object.values(args)).not.toContain(token);
  });

  it('zaproszenie sprzed 0121 (bez języka) → ostatni stopień fallbacku en', async () => {
    const db = setup([pendingRow({ locale: null })]);
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: true });
    expect((db.calls[1]?.args as Record<string, string>).p_locale).toBe('en');
  });

  it('KONTROLA UJEMNA: zaproszenie spoza listy aktywnej firmy → NOT_FOUND bez zapisu', async () => {
    const db = setup([pendingRow({ invitation_id: OTHER })]);
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(db.calls.map((c) => c.name)).toEqual(['get_company_invitations']);
  });

  it('KONTROLA UJEMNA: nie-UUID, brak sesji i brak aktywnej firmy nie docierają do zapisu', async () => {
    const db = setup([pendingRow()]);
    expect(await renewTeamInvitation("x' or 1=1", COMPANY)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(db.calls).toHaveLength(0);

    vi.mocked(getActiveCompany).mockResolvedValue({ activeId: null, activeRole: 'member' } as never);
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(db.calls).toHaveLength(0);

    resetFakeDb(null);
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('KONTROLA UJEMNA: firma widoku ≠ aktywna → ACTIVE_COMPANY_CHANGED, bez żadnego RPC', async () => {
    const db = setup([pendingRow()]);
    expect(await renewTeamInvitation(INVITE, OTHER)).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    expect(await renewTeamInvitation(INVITE, '')).toEqual({ ok: false, error: 'ACTIVE_COMPANY_CHANGED' });
    expect(db.calls).toHaveLength(0);
  });

  it('błędy bazy → stabilne kody (bez technikaliów)', async () => {
    setup([pendingRow()], 'MEMBER_ALREADY_EXISTS');
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: false, error: 'MEMBER_ALREADY_EXISTS' });
    setup([pendingRow()], 'PERMISSION_DENIED');
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
  });

  it('limit i tryb demo', async () => {
    vi.mocked(checkRateLimit).mockResolvedValue(false);
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: false, error: 'RATE_LIMITED' });
    fakeSession.configured = false;
    expect(await renewTeamInvitation(INVITE, COMPANY)).toEqual({ ok: true, demo: true });
  });

  it('migracja 0179 zwraca język i autora bez zmiany bramki owner/admin', () => {
    const sql = readFileSync(
      resolve(process.cwd(), 'supabase/migrations/0179_team_invitation_details.sql'),
      'utf8',
    );
    expect(sql).toMatch(/locale text, inviter_name text/);
    expect(sql).toMatch(/if not public\.is_company_admin\(p_company_id\) then/);
    expect(sql).toMatch(/i\.status = 'pending' and i\.expires_at > now\(\)/);
    expect(sql).toMatch(/grant execute on function public\.get_company_invitations\(uuid\) to authenticated/);
  });
});
