import 'server-only';

import { cache } from 'react';

import { isSupabaseConfigured } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import { canManageTeam } from '@/lib/team/permissions';

/**
 * Dane strony zespołu firmy (#403) — odczyt przez RPC z 0087 pod SESJĄ użytkownika.
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

/** Zaproszenia do zespołów skierowane do zalogowanego (także bez własnej firmy). */
export const getMyTeamInvitations = cache(async (): Promise<MyInvitationsResult> => {
  if (!isSupabaseConfigured()) return { status: 'ok', invitations: [] };
  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const { data, error } = await supabase.rpc('get_my_company_invitations');
    if (error) throw error;
    return { status: 'ok', invitations: mapMyInvitations(data) };
  } catch (error) {
    captureError(error, { area: 'team.getMyTeamInvitations' });
    return { status: 'error' };
  }
});

export async function getTeamPageData(): Promise<TeamPageData> {
  if (!isSupabaseConfigured()) return DEMO_DATA;
  try {
    const { createServerClient } = await import('@/lib/supabase/server');
    const supabase = await createServerClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) return { status: 'error' };

    const { getActiveCompany } = await import('@/lib/company-context');
    const ctx = await getActiveCompany(supabase, user.id);
    if (!ctx.activeId) return { status: 'error' };

    const mine = await getMyTeamInvitations();
    if (mine.status === 'error') return { status: 'error' };

    if (!canManageTeam(ctx.activeRole)) {
      return {
        status: 'ok',
        demo: false,
        activeRole: ctx.activeRole,
        companyName: ctx.activeName,
        members: null,
        invitations: [],
        myInvitations: mine.invitations,
      };
    }

    const [team, invites] = await Promise.all([
      supabase.rpc('get_company_team', { p_company_id: ctx.activeId }),
      supabase.rpc('get_company_invitations', { p_company_id: ctx.activeId }),
    ]);
    if (team.error) throw team.error;
    if (invites.error) throw invites.error;

    const members: TeamMember[] = rows(team.data).map((r) => ({
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
    const invitations: TeamInvitation[] = rows(invites.data).map((r) => ({
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
      myInvitations: mine.invitations,
    };
  } catch (error) {
    captureError(error, { area: 'team.getTeamPageData' });
    return { status: 'error' };
  }
}
