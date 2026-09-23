import { describe, expect, it } from 'vitest';

import { roleFromProfileRead } from '@/lib/auth/profile-role';
import { isAppError } from '@/lib/errors';

describe('roleFromProfileRead (#24)', () => {
  it.each(['candidate', 'employer', 'admin'] as const)('zwraca dozwoloną rolę %s', (role) => {
    expect(roleFromProfileRead({ data: { role }, error: null })).toBe(role);
  });

  it.each([
    ['błąd adaptera', { data: { role: 'employer' }, error: new Error('timeout') }, 'profile_role_read_failed'],
    ['brak profilu', { data: null, error: null }, 'profile_missing'],
    ['nieznana rola', { data: { role: 'moderator' }, error: null }, 'profile_role_invalid'],
    ['wielkość liter', { data: { role: 'Employer' }, error: null }, 'profile_role_invalid'],
    ['rola nie-tekstowa', { data: { role: 1 }, error: null }, 'profile_role_invalid'],
  ])('%s → AppError INTERNAL bez domyślnej roli', (_label, read, reason) => {
    let thrown: unknown;
    try {
      roleFromProfileRead(read);
    } catch (e) {
      thrown = e;
    }
    expect(isAppError(thrown)).toBe(true);
    expect((thrown as { code: string }).code).toBe('INTERNAL');
    expect((thrown as { context?: { reason?: string } }).context?.reason).toBe(reason);
  });
});
