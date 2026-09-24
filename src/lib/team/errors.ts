import type { ErrorCode } from '@/lib/errors';

/**
 * Kody błędów zespołu firmy (#403). Wspólne `ErrorCode` + przypadki właściwe dla zespołu,
 * z komunikatami w `team.error.*` (UI: `teamErrorKey`). Bez technikaliów (Invariant #8).
 */
export type TeamSpecificError =
  | 'MEMBER_ALREADY_EXISTS'
  | 'INVITATION_LIMIT_REACHED'
  | 'COMPANY_LIMIT_REACHED'
  | 'LAST_OWNER';

export type TeamError = ErrorCode | TeamSpecificError;

const TEAM_KEYS: Record<TeamSpecificError, string> = {
  MEMBER_ALREADY_EXISTS: 'team.error.alreadyMember',
  INVITATION_LIMIT_REACHED: 'team.error.invitationLimit',
  COMPANY_LIMIT_REACHED: 'team.error.companyLimit',
  LAST_OWNER: 'team.error.lastOwner',
};

/** Komunikat błędu Postgresa/RLS z RPC zespołu → stabilny kod. */
export function mapTeamError(message: string | undefined): TeamError {
  const m = message ?? '';
  if (m.includes('MEMBER_ALREADY_EXISTS')) return 'MEMBER_ALREADY_EXISTS';
  if (m.includes('INVITATION_LIMIT_REACHED')) return 'INVITATION_LIMIT_REACHED';
  if (m.includes('COMPANY_LIMIT_REACHED')) return 'COMPANY_LIMIT_REACHED';
  if (m.includes('aktywnego właściciela')) return 'LAST_OWNER';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('JWT') ||
    m.includes('permission denied') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/** Klucz i18n komunikatu (pełna ścieżka dla translatora bez przestrzeni nazw). */
export function teamErrorKey(error: TeamError, toUserMessageKey: (code: ErrorCode) => string): string {
  return error in TEAM_KEYS
    ? TEAM_KEYS[error as TeamSpecificError]
    : toUserMessageKey(error as ErrorCode);
}
