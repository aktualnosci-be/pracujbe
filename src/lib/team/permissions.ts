import type { MemberRole } from '@/lib/validation/team';

/**
 * Lustro hierarchii ról z bazy (0086 `can_manage_company_role`) — wyłącznie do UI
 * (ukrywanie niedostępnych akcji). Granicą zaufania pozostaje baza.
 *
 * owner zarządza każdą rolą; admin — tylko recruiter/member; pozostali — niczym.
 */
export function canManageRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'owner') return true;
  if (actorRole === 'admin') return targetRole === 'recruiter' || targetRole === 'member';
  return false;
}

/** Role, które aktor może nadać innemu członkowi (kolejność = od najwyższej). */
export function assignableRoles(actorRole: string): MemberRole[] {
  if (actorRole === 'owner') return ['owner', 'admin', 'recruiter', 'member'];
  if (actorRole === 'admin') return ['recruiter', 'member'];
  return [];
}

/** Czy rola zarządza zespołem (owner/admin) — strona zespołu, zaproszenia. */
export function canManageTeam(role: string): boolean {
  return role === 'owner' || role === 'admin';
}

/** Czy rola tworzy/publikuje oferty i prowadzi rekrutację (recruiter+ — 0033/0037). */
export function canRecruit(role: string): boolean {
  return role === 'owner' || role === 'admin' || role === 'recruiter';
}
