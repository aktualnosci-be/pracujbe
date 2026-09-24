import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { isProductionMode } from '@/lib/env';
import {
  guestApplySecret,
  guestTokenFromNonce,
  hashGuestToken,
  isGuestTokenFormat,
  issueGuestToken,
} from '@/lib/guest-apply/token';

/**
 * #98 — tokeny aplikacji gościa: w bazie tylko hash i nonce; token odtwarza wyłącznie serwer
 * z sekretem. Cel jest częścią podpisu (potwierdzenie ≠ przejęcie). Produkcja bez sekretu
 * nie działa „na domyślnym” kluczu.
 */

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false) }));

const SECRET = 'a'.repeat(40);

beforeEach(() => {
  process.env.GUEST_APPLY_SECRET = SECRET;
  vi.mocked(isProductionMode).mockReturnValue(false);
});
afterEach(() => {
  delete process.env.GUEST_APPLY_SECRET;
});

describe('guest apply tokens', () => {
  it('issued hash matches the token recomputed from the nonce (worker path)', () => {
    const issued = issueGuestToken('confirm');
    expect(issued).not.toBeNull();
    const token = guestTokenFromNonce('confirm', issued!.nonce);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashGuestToken(token!)).toBe(issued!.hash);
    expect(issued!.hash).toMatch(/^[0-9a-f]{64}$/);
    // Nonce ani hash nie są tokenem.
    expect(issued!.hash).not.toContain(token!);
    expect(issued!.nonce).not.toBe(token);
  });

  it('purpose is part of the signature and the secret matters', () => {
    const { nonce } = issueGuestToken('confirm')!;
    expect(guestTokenFromNonce('confirm', nonce)).not.toBe(guestTokenFromNonce('claim', nonce));
    const before = guestTokenFromNonce('claim', nonce);
    process.env.GUEST_APPLY_SECRET = 'b'.repeat(40);
    expect(guestTokenFromNonce('claim', nonce)).not.toBe(before);
  });

  it('every issue uses a fresh nonce', () => {
    expect(issueGuestToken('claim')!.nonce).not.toBe(issueGuestToken('claim')!.nonce);
  });

  it('production without a (long enough) secret refuses to issue tokens', () => {
    vi.mocked(isProductionMode).mockReturnValue(true);
    process.env.GUEST_APPLY_SECRET = 'short';
    expect(guestApplySecret()).toBeNull();
    expect(issueGuestToken('confirm')).toBeNull();
    delete process.env.GUEST_APPLY_SECRET;
    expect(guestTokenFromNonce('confirm', 'x'.repeat(32))).toBeNull();
  });

  it('outside production a development secret keeps the flow testable', () => {
    delete process.env.GUEST_APPLY_SECRET;
    expect(guestApplySecret()).toBeTruthy();
    expect(issueGuestToken('confirm')).not.toBeNull();
  });

  it('token format check rejects garbage before any database call', () => {
    expect(isGuestTokenFormat(guestTokenFromNonce('confirm', 'n'.repeat(32)))).toBe(true);
    for (const bad of ['', 'abc', 'a'.repeat(44), `${'a'.repeat(42)}=`, null, 42]) {
      expect(isGuestTokenFormat(bad)).toBe(false);
    }
  });
});
