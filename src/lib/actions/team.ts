'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';

import { databaseErrorMessage, isDatabaseError, reportUnmappedDbError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc, rpcRows, type RpcArgs } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { ACTIVE_COMPANY_COOKIE, activeCompanyCookieOptions, getExpectedActiveCompany } from '@/lib/company-context';
import { mapTeamError, type TeamError } from '@/lib/team/errors';
import { issueTeamInviteToken, teamInviteTokenForOperation } from '@/lib/team/invite-token';
import { isLocale } from '@/i18n/routing';
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
 *                              bez konta (0121) — wynik nie zależy od istnienia konta,
 *   - `revokeTeamInvitation` — cofnięcie oczekującego zaproszenia,
 *   - `renewTeamInvitation`  — odnowienie oczekującego zaproszenia (adres/rola/język z bazy, 0187),
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
 * (sieć, konfiguracja) → kanał błędów + INTERNAL. Tekst bazy nie trafia do użytkownika.
 */
function failure(error: unknown, area: string): TeamActionResult {
  if (isDatabaseError(error)) {
    return fail(reportUnmappedDbError(error, area, mapTeamError(databaseErrorMessage(error))));
  }
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

const CLIENT_KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #1113: token linku rejestracji. Z poprawnym kluczem operacji (UUID z przeglądarki) — wyliczony
 * z operacji (ponowienie = ten sam token); bez klucza albo z niepoprawnym — losowy jak dotąd.
 */
function operationToken(clientKey: string | undefined, parts: string[]): { nonce: string; hash: string } | null {
  if (typeof clientKey === 'string' && CLIENT_KEY_RE.test(clientKey)) {
    return teamInviteTokenForOperation([...parts, clientKey.toLowerCase()]);
  }
  return issueTeamInviteToken();
}

function fail(error: ErrorCode | TeamError): TeamActionResult {
  return { ok: false, error };
}

/**
 * Zaprasza osobę do firmy, dla której wyrenderowano formularz (`expectedCompanyId`, EMP-02).
 * Gdy aktywna firma zmieniła się w międzyczasie (inna karta), zaproszenie nie trafia do nowej
 * firmy — `ACTIVE_COMPANY_CHANGED`.
 */
export async function inviteTeamMember(
  input: TeamInviteInput,
  expectedCompanyId: string,
  clientKey?: string,
): Promise<TeamActionResult> {
  const parsed = teamInviteSchema.safeParse(input);
  if (!parsed.success) return fail('VALIDATION_FAILED');
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-invite', INVITE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const me = await getPortalIdentity();
    if (!me) return fail('PERMISSION_DENIED');
    // Token liczymy zawsze (baza wie, czy adres ma konto — akcja nie). Bez sekretu w produkcji
    // link rejestracji nie powstałby, więc zaproszenia nie przyjmujemy (nie udajemy wysyłki).
    // #1113: z kluczem operacji ponowienie po błędzie sieci daje ten sam token (bez drugiego
    // e-maila i bez unieważnienia pierwszego linku).
    const signupToken = operationToken(clientKey, [
      'invite',
      me.id,
      expectedCompanyId,
      parsed.data.email.trim().toLowerCase(),
      parsed.data.role,
      parsed.data.locale,
    ]);
    if (!signupToken) {
      captureError(new Error('team invite token secret missing'), { area: 'team.invite.token' });
      return fail('INTERNAL');
    }
    const invited = await withPortalTransaction(me, async (tx): Promise<TeamError | null> => {
      const expected = await getExpectedActiveCompany(tx, me.id, expectedCompanyId);
      if (!expected.ok) return expected.error;
      await rpcRows(tx, 'invite_company_member', {
        p_company_id: expected.context.activeId,
        p_email: parsed.data.email,
        p_role: parsed.data.role,
        p_locale: parsed.data.locale,
        p_signup_token_hash: signupToken.hash,
        p_signup_nonce: signupToken.nonce,
      });
      return null;
    });
    if (invited) return fail(invited);
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

/**
 * Odnowienie oczekującego zaproszenia (0187): kolejne 14 dni ważności i nowy link rejestracji
 * dla adresu bez konta — bez przepisywania adresu, roli i języka przez zapraszającego.
 *
 * Adres, rolę i język bierzemy z BAZY (`get_company_invitations` aktywnej firmy, owner/admin),
 * nie z klienta — klient podaje tylko identyfikator. Zaproszenie spoza aktywnej firmy,
 * wygasłe albo rozstrzygnięte = `NOT_FOUND`. Zapis to ten sam `invite_company_member` co przy
 * zapraszaniu (hierarchia ról, limit e-maili na adres, audyt `company.member_invitation_updated`),
 * w tej samej transakcji co odczyt. Język: zapisany przy zaproszeniu (Invariant #1 — jedyny znany
 * język adresu bez konta); zaproszenie sprzed 0121 bez języka → ostatni stopień fallbacku `en`.
 * Konto z profilem nadal dostaje komunikaty w języku swojego konta (bez nowego e-maila — samo
 * zaproszenie czeka w jego panelu). Wynik nie zależy od tego, czy adres ma konto.
 */
export async function renewTeamInvitation(
  invitationId: string,
  expectedCompanyId: string,
  clientKey?: string,
): Promise<TeamActionResult> {
  if (!uuidSchema.safeParse(invitationId).success) return fail('VALIDATION_FAILED');
  if (!isPortalDataConfigured()) return { ok: true, demo: true };
  if (await limited('team-invite', INVITE_RATE_MAX)) return fail('RATE_LIMITED');

  try {
    const me = await getPortalIdentity();
    if (!me) return fail('PERMISSION_DENIED');
    // #1113: ponowienie TEGO SAMEGO odnowienia (klucz operacji) = ten sam nowy link.
    const signupToken = operationToken(clientKey, ['renew', me.id, expectedCompanyId, invitationId]);
    if (!signupToken) {
      captureError(new Error('team invite token secret missing'), { area: 'team.renew.token' });
      return fail('INTERNAL');
    }
    const renewed = await withPortalTransaction(me, async (tx): Promise<TeamError | null> => {
      // Firma widoku (EMP-02, jak przy zapraszaniu): zmiana aktywnej firmy w innej karcie
      // nie przenosi odnowienia do nowej firmy — `ACTIVE_COMPANY_CHANGED`.
      const expected = await getExpectedActiveCompany(tx, me.id, expectedCompanyId);
      if (!expected.ok) return expected.error;
      const companyId = expected.context.activeId;
      const pending = await rpcRows(tx, 'get_company_invitations', { p_company_id: companyId });
      const row = pending.find((r) => r['invitation_id'] === invitationId);
      const email = typeof row?.['email'] === 'string' ? row['email'] : '';
      const role = typeof row?.['role'] === 'string' ? row['role'] : '';
      if (!row || !email || !role) return 'NOT_FOUND';
      const locale = isLocale(row['locale']) ? row['locale'] : 'en';
      await rpcRows(tx, 'invite_company_member', {
        p_company_id: companyId,
        p_email: email,
        p_role: role,
        p_locale: locale,
        p_signup_token_hash: signupToken.hash,
        p_signup_nonce: signupToken.nonce,
      });
      return null;
    });
    if (renewed) return fail(renewed);
    refreshPanel();
    return { ok: true };
  } catch (e) {
    return failure(e, 'team.renewInvitation');
  }
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
      (await cookies()).set(ACTIVE_COMPANY_COOKIE, companyId, activeCompanyCookieOptions());
    }
    refreshPanel();
    return { ok: true };
  } catch (e) {
    return failure(e, 'team.respond');
  }
}
