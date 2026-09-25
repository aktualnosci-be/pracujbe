import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { rpc, rpcRows } from '@/lib/db/sql';
import { INVITABLE_ROLES, type InvitableRole } from '@/lib/validation/team';
import { hashTeamInviteToken, isTeamInviteTokenFormat } from './invite-token';

/**
 * Link rejestracji z zaproszenia do zespołu (0124). Token z fragmentu `#token=` trafia na
 * serwer wyłącznie w Server Action; do bazy idzie jego hash (`service_role`, bo osoba nie ma
 * jeszcze konta). Nieważny, wygasły, rozstrzygnięty i nieznany token dają ten sam wynik.
 */

export type TeamInvitationSignupPreview =
  | { status: 'valid'; companyName: string; role: InvitableRole; email: string; expiresAt: string }
  | { status: 'used' }
  | { status: 'invalid' };

interface PreviewRow {
  outcome: string | null;
  company_name: string | null;
  role: string | null;
  email: string | null;
  expires_at: string | Date | null;
}

export async function readTeamInvitationSignup(token: unknown): Promise<TeamInvitationSignupPreview> {
  if (!isTeamInviteTokenFormat(token)) return { status: 'invalid' };
  const [row] = await withServiceRole((tx) =>
    rpcRows<PreviewRow>(tx, 'team_invitation_signup_preview', { p_token_hash: hashTeamInviteToken(token) }),
  );
  if (row?.outcome === 'used') return { status: 'used' };
  const role = INVITABLE_ROLES.find((r) => r === row?.role);
  if (row?.outcome !== 'valid' || !role || !row.company_name || !row.email || !row.expires_at) {
    return { status: 'invalid' };
  }
  return {
    status: 'valid',
    companyName: row.company_name,
    role,
    email: row.email,
    expiresAt: new Date(row.expires_at).toISOString(),
  };
}

export type TeamInvitationSignupConsumeOutcome = 'consumed' | 'used' | 'email_mismatch' | 'invalid';

/** Zużywa token dla adresu zaproszenia (raz). */
export async function consumeTeamInvitationSignup(
  token: string,
  email: string,
): Promise<TeamInvitationSignupConsumeOutcome> {
  const outcome = await withServiceRole((tx) =>
    rpc(tx, 'consume_team_invitation_signup', { p_token_hash: hashTeamInviteToken(token), p_email: email }),
  );
  return outcome === 'consumed' || outcome === 'used' || outcome === 'email_mismatch' ? outcome : 'invalid';
}
