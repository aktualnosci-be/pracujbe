import 'server-only';

import { cache } from 'react';

import { getActiveCompany } from '@/lib/company-context';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpcRows } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/error-report';
import { canManageTeam } from '@/lib/team/permissions';

/**
 * Dane strony zespołu firmy (#403) — odczyt przez RPC z 0086 pod SESJĄ użytkownika
 * (`withPortalTransaction`, RLS; nigdy service-role).
 *
 * Wynik jawny: `ok` (także tryb demo bez env, `demo: true`) albo `error` — UI nigdy nie
 * pokazuje pustego zespołu zamiast błędu. Lista członków i zaproszeń firmy tylko dla
 * owner/admin (baza i tak odmówi innym); każdy członek widzi zaproszenia skierowane do siebie.
 */

export interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  joinedAt: string;
  isSelf: boolean;
}

export interface TeamInvitation {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
}

export interface MyTeamInvitation {
  id: string;
  companyName: string;
  role: string;
  inviterName: string;
  expiresAt: string;
}

export type TeamPageData =
  | {
      status: 'ok';
      demo: boolean;
      activeRole: string;
      companyName: string;
      /** `null` — rola bez zarządzania zespołem (recruiter/member). */
      members: TeamMember[] | null;
      invitations: TeamInvitation[];
      myInvitations: MyTeamInvitation[];
    }
  | { status: 'error' };

export type MyInvitationsResult =
  | { status: 'ok'; invitations: MyTeamInvitation[] }
  | { status: 'error' };

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

/* Dane DEMO (bez env) — widok właściciela z przykładowym zespołem. */
const DEMO_DATA: Extract<TeamPageData, { status: 'ok' }> = {
  status: 'ok',
  demo: true,
  activeRole: 'owner',
  companyName: 'AGO Jobs & HR',
  members: [
    {
      id: '00000000-0000-4000-8000-000000000001',
      name: 'Anna Peeters',
      email: 'anna.peeters@example.be',
      role: 'owner',
      isActive: true,
      joinedAt: '2025-01-15T09:00:00.000Z',
      isSelf: true,
    },
    {
      id: '00000000-0000-4000-8000-000000000002',
      name: 'Tom Janssens',
      email: 'tom.janssens@example.be',
      role: 'recruiter',
      isActive: true,
      joinedAt: '2025-02-03T10:00:00.000Z',
      isSelf: false,
    },
    {
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Sofie Maes',
      email: 'sofie.maes@example.be',
      role: 'member',
      isActive: false,
      joinedAt: '2025-03-10T08:30:00.000Z',
      isSelf: false,
    },
  ],
  invitations: [
    {
      id: '00000000-0000-4000-8000-000000000010',
      email: 'nowa.osoba@example.be',
      role: 'recruiter',
      expiresAt: '2030-01-01T00:00:00.000Z',
    },
  ],
  myInvitations: [],
};

function mapMyInvitations(data: unknown): MyTeamInvitation[] {
  return rows(data).map((r) => ({
    id: asString(r['invitation_id']),
    companyName: asString(r['company_name']),
    role: asString(r['role']),
    inviterName: asString(r['inviter_name']),
    expiresAt: asString(r['expires_at']),
  }));
}

function readMyInvitations(tx: TransactionQuery): Promise<Record<string, unknown>[]> {
  return rpcRows(tx, 'get_my_company_invitations');
}

/** Zaproszenia do zespołów skierowane do zalogowanego (także bez własnej firmy). */
export const getMyTeamInvitations = cache(async (): Promise<MyInvitationsResult> => {
  if (!isPortalDataConfigured()) return { status: 'ok', invitations: [] };
  try {
    const me = await getPortalIdentity();
    // Gość nie ma prawa wykonania RPC (tylko authenticated) — jak dotąd: stan błędu.
    if (!me) return { status: 'error' };
    const data = await withPortalTransaction(me, readMyInvitations);
    return { status: 'ok', invitations: mapMyInvitations(data) };
  } catch (error) {
    captureError(error, { area: 'team.getMyTeamInvitations' });
    return { status: 'error' };
  }
});

export async function getTeamPageData(): Promise<TeamPageData> {
  if (!isPortalDataConfigured()) return DEMO_DATA;
  try {
    const me = await getPortalIdentity();
    if (!me) return { status: 'error' };

    // Jedna transakcja „wszystko albo nic": kontekst firmy, własne zaproszenia, zespół.
    const loaded = await withPortalTransaction(me, async (tx) => {
      const ctx = await getActiveCompany(tx, me.id);
      if (!ctx.activeId) return null;
      const mine = await readMyInvitations(tx);
      if (!canManageTeam(ctx.activeRole)) return { ctx, mine, team: null, invites: [] };
      const team = await rpcRows(tx, 'get_company_team', { p_company_id: ctx.activeId });
      const invites = await rpcRows(tx, 'get_company_invitations', { p_company_id: ctx.activeId });
      return { ctx, mine, team, invites };
    });
    if (!loaded) return { status: 'error' };
    const { ctx } = loaded;
    const myInvitations = mapMyInvitations(loaded.mine);

    if (loaded.team === null) {
      return {
        status: 'ok',
        demo: false,
        activeRole: ctx.activeRole,
        companyName: ctx.activeName,
        members: null,
        invitations: [],
        myInvitations,
      };
    }

    const members: TeamMember[] = rows(loaded.team).map((r) => ({
      id: asString(r['member_id']),
      name: [asString(r['first_name']), asString(r['last_name'])]
        .map((s) => s.trim())
        .filter(Boolean)
        .join(' '),
      email: asString(r['email']),
      role: asString(r['role']),
      isActive: r['is_active'] === true,
      joinedAt: asString(r['joined_at']),
      isSelf: r['is_self'] === true,
    }));
    const invitations: TeamInvitation[] = rows(loaded.invites).map((r) => ({
      id: asString(r['invitation_id']),
      email: asString(r['email']),
      role: asString(r['role']),
      expiresAt: asString(r['expires_at']),
    }));

    return {
      status: 'ok',
      demo: false,
      activeRole: ctx.activeRole,
      companyName: ctx.activeName,
      members,
      invitations,
      myInvitations,
    };
  } catch (error) {
    captureError(error, { area: 'team.getTeamPageData' });
    return { status: 'error' };
  }
}
