import { describe, expect, it } from 'vitest';

import { applicationSchema } from '@/lib/validation/application';
import { normalizePhone } from '@/lib/validation/phone';

/** #145 — numer telefonu aplikacji: walidacja i kanoniczny E.164. */

describe('normalizePhone', () => {
  it.each([
    ['470 12 34 56', 'BE', '+32470123456'],
    ['512 345 678', 'PL', '+48512345678'],
    ['06 12345678', 'NL', '+31612345678'],
    ['06 12 34 56 78', 'FR', '+33612345678'],
    ['0151 23456789', 'DE', '+4915123456789'],
    ['621 123 456', 'LU', '+352621123456'],
  ] as const)('accepts national %s with country %s', (raw, country, e164) => {
    expect(normalizePhone(raw, country)).toBe(e164);
  });

  it.each([
    ['+32 470 12 34 56', '+32470123456'],
    ['+48 512 345 678', '+48512345678'],
    ['+31 6 12345678', '+31612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+49 151 23456789', '+4915123456789'],
    ['+352 621 123 456', '+352621123456'],
  ])('accepts international %s regardless of the selected country', (raw, e164) => {
    // Wybrany PL nie dokleja drugiego kodu kraju do wklejonego pełnego numeru.
    expect(normalizePhone(raw, 'PL')).toBe(e164);
  });

  it('gives one canonical value for formatting variants', () => {
    const variants = ['470123456', '470 12 34 56', '(470) 12-34-56', '470.12.34.56', '0470 12 34 56', '+32 (0)470 12 34 56', '0032 470 12 34 56'];
    expect(new Set(variants.map((v) => normalizePhone(v, 'BE')))).toEqual(new Set(['+32470123456']));
  });

  it.each([
    ['only separators', '------'],
    ['spaces and dots', '  . . .  '],
    ['letters', 'abc'],
    ['too short', '1'],
    ['too long', '4701234567890123'],
    ['impossible country code', '+999 123 456 789'],
    ['text around a number', 'tel 470 12 34 56'],
    ['empty', ''],
  ])('rejects %s', (_reason, raw) => {
    expect(normalizePhone(raw, 'BE')).toBeNull();
  });
});

describe('applicationSchema — phone', () => {
  const base = {
    jobId: '11111111-1111-4111-8111-111111111111',
    agreeTerms: true as const,
  };

  it('stores the E.164 form', () => {
    const parsed = applicationSchema.parse({ ...base, phone: '0470 12 34 56', phoneCountry: 'BE' });
    expect(parsed.phone).toBe('+32470123456');
  });

  it('reports an invalid phone on the phone field', () => {
    const parsed = applicationSchema.safeParse({ ...base, phone: '------', phoneCountry: 'PL' });
    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]).toMatchObject({
      path: ['phone'],
      message: 'application.error.phoneInvalid',
    });
  });

  it('rejects an unsupported country', () => {
    expect(
      applicationSchema.safeParse({ ...base, phone: '470123456', phoneCountry: 'US' }).success,
    ).toBe(false);
  });
});
