import { describe, expect, it } from 'vitest';

import {
  COMPANY_DESCRIPTION_MAX,
  COMPANY_DESCRIPTION_REASON_MAX,
  companyDescriptionReasonError,
  parseCompanyDescriptionReview,
} from '@/lib/company-description';
import { companyDescriptionSchema } from '@/lib/validation/company';

/** Opis firmy (#868, 0198): schemat wejścia, lustro limitów bazy i odczyt stanu propozycji. */

describe('companyDescriptionSchema', () => {
  it('accepts a normal text, trims it and accepts an empty one (removal)', () => {
    expect(companyDescriptionSchema.parse({ description: '  Agencja pracy w Gandawie.  ' })).toEqual({
      description: 'Agencja pracy w Gandawie.',
    });
    expect(companyDescriptionSchema.parse({ description: '   ' })).toEqual({ description: '' });
  });

  it('enforces the same limit as the database CHECK (1500 characters after trimming)', () => {
    expect(COMPANY_DESCRIPTION_MAX).toBe(1500);
    expect(companyDescriptionSchema.safeParse({ description: 'x'.repeat(1500) }).success).toBe(true);
    const tooLong = companyDescriptionSchema.safeParse({ description: 'x'.repeat(1501) });
    expect(tooLong.success).toBe(false);
    expect(tooLong.success ? '' : tooLong.error.issues[0]?.message).toBe('company.error.descriptionTooLong');
    // Białe znaki na brzegach nie liczą się do limitu (jak `btrim` w RPC).
    expect(companyDescriptionSchema.safeParse({ description: ` ${'x'.repeat(1500)} ` }).success).toBe(true);
  });

  it('rejects a national register number and a document number, like other fields', () => {
    for (const description of ['Kontakt: 85.07.30-033-28', 'Właściciel, paszport nr AB1234567']) {
      const parsed = companyDescriptionSchema.safeParse({ description });
      expect(parsed.success).toBe(false);
      expect(parsed.success ? '' : parsed.error.issues[0]?.message).toBe('company.error.descriptionSensitive');
    }
  });

  it('negative control: an ordinary text with digits (year, headcount) passes', () => {
    expect(
      companyDescriptionSchema.safeParse({ description: 'Działamy od 1998 roku, zatrudniamy 250 osób.' }).success,
    ).toBe(true);
  });
});

describe('parseCompanyDescriptionReview', () => {
  it('returns the pending proposal with the CAS timestamp', () => {
    expect(
      parseCompanyDescriptionReview({
        description_review_status: 'pending',
        description_pending: 'Nowy opis',
        description_pending_at: '2026-09-29 10:00:00.123+00',
        description_review_reason: null,
      }),
    ).toEqual({
      status: 'pending',
      text: 'Nowy opis',
      submittedAt: '2026-09-29 10:00:00.123+00',
      reason: null,
      locale: null,
    });
  });

  it('carries the proposal language (0975); a value outside the site languages is ignored', () => {
    const row = {
      description_review_status: 'pending',
      description_pending: 'Nowy opis',
      description_pending_at: '2026-09-29 10:00:00+00',
    };
    expect(parseCompanyDescriptionReview({ ...row, description_locale_pending: 'fr' })?.locale).toBe('fr');
    expect(parseCompanyDescriptionReview({ ...row, description_locale_pending: 'de' })?.locale).toBeNull();
  });

  it('shows the reason only for a rejected proposal', () => {
    expect(
      parseCompanyDescriptionReview({
        description_review_status: 'rejected',
        description_pending: 'Nowy opis',
        description_pending_at: '2026-09-29 10:00:00+00',
        description_review_reason: 'Dane kontaktowe.',
      })?.reason,
    ).toBe('Dane kontaktowe.');
    expect(
      parseCompanyDescriptionReview({
        description_review_status: 'pending',
        description_pending: 'Nowy opis',
        description_review_reason: 'zbłąkany powód',
      })?.reason,
    ).toBeNull();
  });

  it('negative control: no status, an unknown status or an empty text is no proposal', () => {
    expect(parseCompanyDescriptionReview({})).toBeNull();
    expect(
      parseCompanyDescriptionReview({ description_review_status: 'approved', description_pending: 'x' }),
    ).toBeNull();
    expect(
      parseCompanyDescriptionReview({ description_review_status: 'pending', description_pending: '' }),
    ).toBeNull();
  });
});

describe('companyDescriptionReasonError', () => {
  it('rejection requires a reason, approval does not, and the limit is 1000', () => {
    expect(companyDescriptionReasonError('rejected', '   ')).toBe('required');
    expect(companyDescriptionReasonError('approved', '')).toBeNull();
    expect(companyDescriptionReasonError('rejected', 'Powód')).toBeNull();
    expect(companyDescriptionReasonError('rejected', 'x'.repeat(COMPANY_DESCRIPTION_REASON_MAX + 1))).toBe('tooLong');
  });
});
