import { describe, expect, it } from 'vitest';

import { parseConfirmAgePolicyArgs } from '../../scripts/db/confirm-age-policy.mjs';

/** Skrypt zatwierdzenia progu wieku przez właściciela (#639, migracja 0946). */
describe('parseConfirmAgePolicyArgs', () => {
  const VERSION = '2026-09-25 10:00:00.123456+00';

  it('--status bez innych argumentów', () => {
    expect(parseConfirmAgePolicyArgs(['--status'])).toEqual({ ok: true, status: true });
    expect(parseConfirmAgePolicyArgs(['--status', '--min-age', '16']).ok).toBe(false);
  });

  it('poprawne zatwierdzenie: próg, znacznik, notatka, potwierdzenie', () => {
    expect(
      parseConfirmAgePolicyArgs(['--min-age', '16', '--expected', VERSION, '--note', ' Decyzja 25.09 ', '--confirm', '16']),
    ).toEqual({ ok: true, status: false, minAge: 16, expected: VERSION, note: 'Decyzja 25.09' });
  });

  it('kontrole ujemne: próg spoza 16/18, brak znacznika, brak notatki, potwierdzenie innego progu', () => {
    expect(parseConfirmAgePolicyArgs(['--min-age', '17', '--expected', VERSION, '--note', 'x', '--confirm', '17']).ok).toBe(false);
    expect(parseConfirmAgePolicyArgs(['--min-age', '16', '--note', 'x', '--confirm', '16']).ok).toBe(false);
    expect(parseConfirmAgePolicyArgs(['--min-age', '16', '--expected', VERSION, '--note', '  ', '--confirm', '16']).ok).toBe(false);
    expect(parseConfirmAgePolicyArgs(['--min-age', '16', '--expected', VERSION, '--note', 'x', '--confirm', '18']).ok).toBe(false);
    expect(parseConfirmAgePolicyArgs(['--min-age', '16', '--expected', VERSION, '--note', 'x'.repeat(1001), '--confirm', '16']).ok).toBe(false);
    expect(parseConfirmAgePolicyArgs(['--confirmed', 'true']).ok).toBe(false);
  });
});
