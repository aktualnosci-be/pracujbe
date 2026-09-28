import { describe, expect, it } from 'vitest';
import { z } from 'zod/v3';

import {
  cvApprovedProposalsSchema,
  findDuplicateLanguageIds,
  normalizeLanguageName,
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

/**
 * #805 — dwa zatwierdzone języki, których nazwa jest po normalizacji identyczna (np. inny zapis
 * wielkości liter/spacji), ale poziom różny: RPC 0115 (`DISTINCT ON (lower(btrim(language)))`)
 * zachowałby tylko jeden z nich bez ostrzeżenia. `findDuplicateLanguageIds` pozwala UI wskazać
 * konflikt PRZED wysyłką, a schemat serwera go odrzuca jako obronę w głębi.
 */
describe('duplikat języka po normalizacji (#805)', () => {
  it('normalizeLanguageName ujednolica wielkość liter i białe znaki brzegowe', () => {
    expect(normalizeLanguageName('  English ')).toBe('english');
    expect(normalizeLanguageName('ENGLISH')).toBe('english');
    expect(normalizeLanguageName('English')).toBe(normalizeLanguageName('english'));
  });

  it('findDuplicateLanguageIds oznacza obie pozycje o tej samej znormalizowanej nazwie', () => {
    const duplicates = findDuplicateLanguageIds([
      { id: 'language-0', language: 'English' },
      { id: 'language-1', language: '  english ' },
      { id: 'language-2', language: 'Nederlands' },
    ]);
    expect(duplicates).toEqual(new Set(['language-0', 'language-1']));
  });

  it('kontrola ujemna: różne nazwy albo jedna pozycja nie dają duplikatu', () => {
    expect(findDuplicateLanguageIds([{ id: 'a', language: 'English' }])).toEqual(new Set());
    expect(
      findDuplicateLanguageIds([
        { id: 'a', language: 'English' },
        { id: 'b', language: 'Nederlands' },
      ]),
    ).toEqual(new Set());
  });

  it('cvApprovedProposalsSchema odrzuca dwa języki z tą samą znormalizowaną nazwą i różnym poziomem', () => {
    const withDuplicate = {
      occupations: [],
      skills: [],
      languages: [
        { language: 'English', level: 'basic' },
        { language: '  english ', level: 'fluent' },
      ],
      certificates: [],
      experienceYears: null,
    };
    expect(cvApprovedProposalsSchema.safeParse(withDuplicate).success).toBe(false);

    // Kontrola ujemna: te same dwie pozycje, ale nazwy rozróżnialne po normalizacji, przechodzą.
    const withoutDuplicate = {
      ...withDuplicate,
      languages: [
        { language: 'English', level: 'basic' },
        { language: 'Nederlands', level: 'fluent' },
      ],
    };
    expect(cvApprovedProposalsSchema.safeParse(withoutDuplicate).success).toBe(true);
  });
});
