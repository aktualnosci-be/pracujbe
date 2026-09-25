'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc, rpcRows, type RpcArgs } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { ACTIVE_COMPANY_COOKIE, getActiveCompany } from '@/lib/company-context';
import { mapTeamError, type TeamError } from '@/lib/team/errors';
import { issueTeamInviteToken } from '@/lib/team/invite-token';
import {
  memberRoleSchema,
  teamInviteSchema,
  uuidSchema,
  type TeamInviteInput,
} from '@/lib/validation/team';

/**
 * Server Actions zespołu firmy (#403). Zapis wyłącznie przez RPC z 0086 pod SESJĄ
 * użytkownika (`withPortalTransaction` — RLS, nigdy service-role). Autoryzację i hierarchię ról egzekwuje baza;
 * akcje walidują wejście (Zod), dokładają limit per IP i mapują błędy na stabilne kody
 * (Invariant #8). Bez env → tryb demo (`{ ok: true, demo: true }`).
 *
 *   - `inviteTeamMember`     — zaproszenie po e-mailu do AKTYWNEJ firmy (idempotentne); język
 *                              zaproszenia i jednorazowy token linku rejestracji dla adresu
 *                              bez konta (0109) — wynik nie zależy od istnienia konta,
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

/**
 * Wyjątek akcji → wynik: błąd bazy (RAISE w RPC, RLS) → stabilny kod zespołu; inny wyjątek
 * (sieć, konfiguracja) → Sentry + INTERNAL. Tekst bazy nie trafia do użytkownika.
 */
function failure(error: unknown, area: string): TeamActionResult {
  if (isDatabaseError(error)) return fail(mapTeamError(databaseErrorMessage(error)));
  captureError(error, { area });
  return fail('INTERNAL');
}

/** RPC zespołu (void) pod sesją zalogowanego użytkownika. */
async function sessionRpc(fn: string, args: RpcArgs, area: string): Promise<TeamActionResult> {
  try {
    const me = await getPortalIdentity();
    if (!me) return fail('PERMISSION_DENIED');
    await withPortalTransaction(me, (tx) => rpc(tx, fn, args));
    refreshPanel();
    return { ok: true };
  } catch (e) {
    return failure(e, area);
  }
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
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-invite', INVITE_RATE_MAX)) return fail('RATE_LIMITED');
  // Token liczymy zawsze (baza wie, czy adres ma konto — akcja nie). Bez sekretu w produkcji
  // link rejestracji nie powstałby, więc zaproszenia nie przyjmujemy (nie udajemy wysyłki).
  const signupToken = issueTeamInviteToken();
  if (!signupToken) {
    captureError(new Error('team invite token secret missing'), { area: 'team.invite.token' });
    return fail('INTERNAL');
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return fail('PERMISSION_DENIED');
    const invited = await withPortalTransaction(me, async (tx) => {
      const active = await getActiveCompany(tx, me.id);
      if (!active.activeId) return false;
      await rpcRows(tx, 'invite_company_member', {
        p_company_id: active.activeId,
        p_email: parsed.data.email,
        p_role: parsed.data.role,
        p_locale: parsed.data.locale,
        p_signup_token_hash: signupToken.hash,
        p_signup_nonce: signupToken.nonce,
      });
      return true;
    });
    if (!invited) return fail('NOT_FOUND');
    refreshPanel();
    return { ok: true };
  } catch (e) {
    return failure(e, 'team.invite');
  }
}

export async function revokeTeamInvitation(invitationId: string): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(invitationId).success) return fail('VALIDATION_FAILED');
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-manage', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  return sessionRpc('revoke_company_invitation', { p_invitation_id: invitationId }, 'team.revokeInvitation');
}

export async function setTeamMemberRole(memberId: string, role: string): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(memberId).success || !memberRoleSchema.safeParse(role).success) {
    return fail('VALIDATION_FAILED');
  }
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-manage', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  return sessionRpc('set_company_member_role', { p_member_id: memberId, p_role: role }, 'team.setRole');
}

export async function setTeamMemberActive(
  memberId: string,
  active: boolean,
): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(memberId).success || typeof active !== 'boolean') {
    return fail('VALIDATION_FAILED');
  }
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-manage', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  return sessionRpc('set_company_member_active', { p_member_id: memberId, p_active: active }, 'team.setActive');
}

export async function respondToTeamInvitation(
  invitationId: string,
  accept: boolean,
): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(invitationId).success || typeof accept !== 'boolean') {
    return fail('VALIDATION_FAILED');
  }
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-respond', MANAGE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const me = await getPortalIdentity();
    if (!me) return fail('PERMISSION_DENIED');
    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'respond_to_company_invitation', { p_invitation_id: invitationId, p_accept: accept }),
    );

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
    return failure(e, 'team.respond');
  }
}
