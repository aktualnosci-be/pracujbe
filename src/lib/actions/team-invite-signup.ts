'use server';

import { isPortalDataConfigured } from '@/lib/db/portal';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { readTeamInvitationSignup, type TeamInvitationSignupPreview } from '@/lib/team/invite-signup';

/**
 * Podgląd zaproszenia z linku rejestracji (0121): strona `/rejestracja-pracodawca` czyta token
 * z fragmentu `#token=` (nie trafia do serwera w adresie ani do logów) i wysyła go tu POST-em.
 * Wynik: dane zaproszenia (firma, rola, adres) albo `used`/`invalid` — bez powodu nieważności.
 * Awaria bazy = `invalid` z wpisem w Sentry (formularz pokazuje zwykłą rejestrację).
 */
export async function previewTeamInvitationSignup(token: string): Promise<TeamInvitationSignupPreview> {
  if (!isPortalDataConfigured()) return { status: 'invalid' };
  if (!(await checkRateLimit('team-invite-link', { max: 30, windowSeconds: 3600 }))) {
    return { status: 'invalid' };
  }
  try {
    return await readTeamInvitationSignup(token);
  } catch (error) {
    captureError(error, { area: 'team.inviteSignup.preview' });
    return { status: 'invalid' };
  }
}
