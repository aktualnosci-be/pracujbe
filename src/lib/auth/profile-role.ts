import { AppError } from '@/lib/errors';

export type ProfileRole = 'candidate' | 'employer' | 'admin';

const ROLES: readonly string[] = ['candidate', 'employer', 'admin'];

/**
 * Rola z odczytu `profiles.role` po zalogowaniu (#24). Tylko jawna, dozwolona wartość
 * wyznacza panel. Błąd odczytu, brak profilu lub nieznana rola → `AppError('INTERNAL')`
 * zamiast domyślnego „candidate": awaria nie może przekierować pracodawcy ani admina
 * do cudzego panelu. Szczegóły trafiają tylko do kontekstu błędu, nie do użytkownika.
 */
export function roleFromProfileRead(result: { data: unknown; error?: unknown }): ProfileRole {
  if (result.error) {
    throw new AppError('INTERNAL', { context: { reason: 'profile_role_read_failed' } });
  }
  if (!result.data) {
    throw new AppError('INTERNAL', { context: { reason: 'profile_missing' } });
  }
  const role = (result.data as { role?: unknown }).role;
  if (typeof role !== 'string' || !ROLES.includes(role)) {
    throw new AppError('INTERNAL', { context: { reason: 'profile_role_invalid' } });
  }
  return role as ProfileRole;
}
