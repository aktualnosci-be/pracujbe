'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { createServerClient } from '@/lib/supabase/server';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { ACTIVE_COMPANY_COOKIE, getActiveCompany } from '@/lib/company-context';
import { mapTeamError, type TeamError } from '@/lib/team/errors';
import {
  memberRoleSchema,
  teamInviteSchema,
  uuidSchema,
  type TeamInviteInput,
} from '@/lib/validation/team';

/**
 * Server Actions zespołu firmy (#403). Zapis wyłącznie przez RPC z 0087 pod SESJĄ
 * użytkownika (RLS, nigdy service-role). Autoryzację i hierarchię ról egzekwuje baza;
 * akcje walidują wejście (Zod), dokładają limit per IP i mapują błędy na stabilne kody
 * (Invariant #8). Bez env → tryb demo (`{ ok: true, demo: true }`).
 *
 *   - `inviteTeamMember`     — zaproszenie po e-mailu do AKTYWNEJ firmy (idempotentne),
 *   - `revokeTeamInvitation` — cofnięcie oczekującego zaproszenia,
 *   - `setTeamMemberRole`    — zmiana roli członka,
 *   - `setTeamMemberActive`  — dezaktywacja / przywrócenie członka,
 *   - `respondToTeamInvitation` — przyjęcie / odrzucenie zaproszenia przez adresata;
 *                              po przyjęciu nowa firma staje się aktywna.
 */

export type TeamActionResult = { ok: true; demo?: boolean } | { ok: false; error: TeamError };

const RATE_WINDOW_SECONDS = 3600;
const INVITE_RATE_MAX = 30;
const MANAGE_RATE_MAX = 120;

async function sessionClient() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, user };
}

function refreshPanel(): void {
  revalidatePath('/employer', 'layout');
}

async function limited(bucket: string, max: number): Promise<boolean> {
  return !(await checkRateLimit(bucket, { max, windowSeconds: RATE_WINDOW_SECONDS }));
}

function fail(error: ErrorCode | TeamError): TeamActionResult {
  return { ok: false, error };
}

export async function inviteTeamMember(input: TeamInviteInput): Promise<TeamActionResult> {
  const parsed = teamInviteSchema.safeParse(input);
  if (!parsed.success) return fail('VALIDATION_FAILED');
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (await limited('team-invite', INVITE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const { supabase, user } = await sessionClient();
    if (!user) return fail('PERMISSION_DENIED');
    const active = await getActiveCompany(supabase, user.id);
    if (!active.activeId) return fail('NOT_FOUND');

    const { error } = await supabase.rpc('invite_company_member', {
      p_company_id: active.activeId,
      p_email: parsed.data.email,
      p_role: parsed.data.role,
    });
    if (error) return fail(mapTeamError(error.message));
    refreshPanel();
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'team.invite' });
    return fail('INTERNAL');
  }
}

export async function revokeTeamInvitation(invitationId: string): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(invitationId).success) return fail('VALIDATION_FAILED');
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (await limited('team-manage', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const { supabase, user } = await sessionClient();
    if (!user) return fail('PERMISSION_DENIED');
    const { error } = await supabase.rpc('revoke_company_invitation', {
      p_invitation_id: invitationId,
    });
    if (error) return fail(mapTeamError(error.message));
    refreshPanel();
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'team.revokeInvitation' });
    return fail('INTERNAL');
  }
}

export async function setTeamMemberRole(memberId: string, role: string): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(memberId).success || !memberRoleSchema.safeParse(role).success) {
    return fail('VALIDATION_FAILED');
  }
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (await limited('team-manage', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const { supabase, user } = await sessionClient();
    if (!user) return fail('PERMISSION_DENIED');
    const { error } = await supabase.rpc('set_company_member_role', {
      p_member_id: memberId,
      p_role: role,
    });
    if (error) return fail(mapTeamError(error.message));
    refreshPanel();
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'team.setRole' });
    return fail('INTERNAL');
  }
}

export async function setTeamMemberActive(
  memberId: string,
  active: boolean,
): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(memberId).success || typeof active !== 'boolean') {
    return fail('VALIDATION_FAILED');
  }
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (await limited('team-manage', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const { supabase, user } = await sessionClient();
    if (!user) return fail('PERMISSION_DENIED');
    const { error } = await supabase.rpc('set_company_member_active', {
      p_member_id: memberId,
      p_active: active,
    });
    if (error) return fail(mapTeamError(error.message));
    refreshPanel();
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'team.setActive' });
    return fail('INTERNAL');
  }
}

export async function respondToTeamInvitation(
  invitationId: string,
  accept: boolean,
): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(invitationId).success || typeof accept !== 'boolean') {
    return fail('VALIDATION_FAILED');
  }
  if (!isSupabaseConfigured()) return { ok: true, demo: true };
  if (await limited('team-respond', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const { supabase, user } = await sessionClient();
    if (!user) return fail('PERMISSION_DENIED');
    const { data, error } = await supabase.rpc('respond_to_company_invitation', {
      p_invitation_id: invitationId,
      p_accept: accept,
    });
    if (error) return fail(mapTeamError(error.message));

    // Po przyjęciu przełączamy na nową firmę (cookie to tylko podpowiedź — getActiveCompany
    // i tak waliduje członkostwo przy każdym odczycie).
    const companyId = typeof data === 'string' ? data : '';
    if (accept && uuidSchema.safeParse(companyId).success) {
      (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    refreshPanel();
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'team.respond' });
    return fail('INTERNAL');
  }
}
