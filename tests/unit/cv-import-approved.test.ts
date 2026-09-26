import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import {
  cvApprovedProposalsSchema,
  parseExperienceYears,
  proposalValueMaxLength,
  proposalValueProblem,
} from '@/lib/cv-import/approved';
import { CANDIDATE_ITEM_LIMITS, step2Schema, step3Schema, step5Schema } from '@/lib/validation/candidate';

/**
 * #487 — edycja wartości propozycji importu CV: pole w przeglądarce i akcja zapisu używają
 * tych samych schematów co kroki kreatora onboardingu (step2/3/5Schema, CANDIDATE_ITEM_LIMITS).
 */

const EMPTY = { occupations: [], skills: [], languages: [], certificates: [], experienceYears: null };

describe('limity = kreator onboardingu', () => {
  it('wartość na granicy przechodzi, o znak dłuższa jest odrzucana — tak samo jak w kreatorze', () => {
    const cases = [
      ['occupation', 'occupations', CANDIDATE_ITEM_LIMITS.occupation, (v: string) => step2Schema.shape.occupations.safeParse([v])],
      ['skill', 'skills', CANDIDATE_ITEM_LIMITS.skill, (v: string) => step3Schema.shape.skills.safeParse([v])],
      ['certificate', 'certificates', CANDIDATE_ITEM_LIMITS.certificate, (v: string) => step5Schema.shape.certificates.safeParse([v])],
    ] as const;
    for (const [kind, key, max, wizard] of cases) {
      const ok = 'a'.repeat(max);
      const tooLong = 'a'.repeat(max + 1);
      expect(proposalValueMaxLength(kind)).toBe(max);
      expect(proposalValueProblem(kind, ok), kind).toBeNull();
      expect(proposalValueProblem(kind, tooLong), kind).toBe('tooLong');
      expect(wizard(ok).success).toBe(true);
      expect(wizard(tooLong).success).toBe(false);
      expect(cvApprovedProposalsSchema.safeParse({ ...EMPTY, [key]: [ok] }).success, key).toBe(true);
      expect(cvApprovedProposalsSchema.safeParse({ ...EMPTY, [key]: [tooLong] }).success, key).toBe(false);
    }
  });

  it('kontrola ujemna: schemat bez limitu kreatora przyjąłby te same za długie wartości', () => {
    const naive = z.string().trim().min(1);
    for (const max of Object.values(CANDIDATE_ITEM_LIMITS)) {
      expect(naive.safeParse('a'.repeat(max + 1)).success).toBe(true);
    }
  });

  it('język: 2–40 znaków i poziom ze słownika; lata: liczba całkowita 0–60', () => {
    expect(proposalValueProblem('language', 'Nederlands', 'fluent')).toBeNull();
    expect(proposalValueProblem('language', 'N')).toBe('languageInvalid');
    expect(proposalValueProblem('language', 'x'.repeat(41))).toBe('languageInvalid');
    expect(proposalValueProblem('language', '   ')).toBe('required');
    expect(proposalValueMaxLength('language')).toBe(40);

    expect(proposalValueProblem('experienceYears', '0')).toBeNull();
    expect(proposalValueProblem('experienceYears', '60')).toBeNull();
    for (const bad of ['61', '-1', '5,5', '5 lat', 'abc']) {
      expect(proposalValueProblem('experienceYears', bad), bad).toBe('experienceInvalid');
    }
    expect(proposalValueProblem('experienceYears', '')).toBe('required');
    expect(parseExperienceYears(' 7 ')).toBe(7);
    expect(Number.isNaN(parseExperienceYears('7.5'))).toBe(true);
  });

  it('pusta wartość po edycji = „wymagane”; kontakt, link, osoba trzecia = odrzucenie', () => {
    expect(proposalValueProblem('skill', '   ')).toBe('required');
    for (const bad of ['jan@example.com', 'https://example.com', 'Referencje: Jan Kowalski']) {
      expect(proposalValueProblem('skill', bad), bad).toBe('disallowed');
    }
    expect(proposalValueProblem('language', 'Nederlands jan@example.com')).toBe('disallowed');
  });
});
