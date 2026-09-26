// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import { readinessChecks } from '@/lib/env';
import { guestApplySecret } from '@/lib/guest-apply/token';

/**
 * Odbiór startu (26.09.2026): operator sprawdza w `/api/health` (szczegóły za tokenem) także
 * sekret aplikacji gościa i sekret linków wypisania — wcześniej widoczne tylko w liście zmiennych.
 * Wskaźnik ma odpowiadać temu, czy funkcja w produkcji naprawdę dostaje sekret.
 */

afterEach(() => vi.unstubAllEnvs());

describe('readinessChecks — sekrety gościa i wypisania', () => {
  it('true przy sekretach ≥ 32 znaki', () => {
    vi.stubEnv('GUEST_APPLY_SECRET', 'g'.repeat(32));
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', 'u'.repeat(32));
    expect(readinessChecks()).toMatchObject({ guestApplySecret: true, unsubscribeSecret: true });
  });

  it.each(['', 'krotki-sekret', 'x'.repeat(31)])('kontrola ujemna: %j = false (także w trybie demo)', (value) => {
    vi.stubEnv('APP_MODE', '');
    vi.stubEnv('GUEST_APPLY_SECRET', value);
    vi.stubEnv('EMAIL_UNSUBSCRIBE_SECRET', value);
    // Tryb demo ma sekret deweloperski gościa — wskaźnik nie może go liczyć jako konfiguracji.
    expect(readinessChecks()).toMatchObject({ guestApplySecret: false, unsubscribeSecret: false });
  });

  it.each([['g'.repeat(32), true], ['g'.repeat(31), false], ['', false]] as const)(
    'w produkcji zgodne z guestApplySecret(): %j → %s',
    (value, expected) => {
      vi.stubEnv('APP_MODE', 'production');
      vi.stubEnv('GUEST_APPLY_SECRET', value);
      expect(readinessChecks().guestApplySecret).toBe(expected);
      expect(guestApplySecret() !== null).toBe(expected);
    },
  );
});
