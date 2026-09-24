import { describe, expect, it } from 'vitest';

import {
  APPLICATION_AVAILABILITY_VALUES,
  APPLY_AVAILABILITY_OPTIONS as AVAILABILITY,
  APPLY_AVAILABILITY_TO_DB as AVAILABILITY_TO_DB,
  applicationSchema,
} from '@/lib/validation/application';
import { availabilitySchema, AVAILABILITY_VALUES } from '@/lib/validation/candidate';

/** #190: „za 2 tygodnie" i „za miesiąc" zapisują rozróżnialne wartości. */
const base = { jobId: '5b2d6c1e-8f0a-4b43-9d2e-1f7a3c9e4b10', agreeTerms: true as const };

describe('dostępność w aplikacji (#190)', () => {
  it('każda widoczna opcja mapuje się na inną wartość bazy', () => {
    const values = AVAILABILITY.map((option) => AVAILABILITY_TO_DB[option]);
    expect(new Set(values).size).toBe(AVAILABILITY.length);
    expect(AVAILABILITY_TO_DB.twoWeeks).toBe('within_two_weeks');
    expect(AVAILABILITY_TO_DB.oneMonth).toBe('within_month');
  });

  it('walidacja aplikacji przyjmuje obie wartości i zachowuje je w payloadzie', () => {
    for (const option of ['twoWeeks', 'oneMonth'] as const) {
      const parsed = applicationSchema.parse({ ...base, availability: AVAILABILITY_TO_DB[option] });
      expect(parsed.availability).toBe(AVAILABILITY_TO_DB[option]);
    }
  });

  it('istniejące wartości profilu nadal są poprawne w aplikacji; nieznana odrzucona', () => {
    for (const value of AVAILABILITY_VALUES) {
      expect(APPLICATION_AVAILABILITY_VALUES).toContain(value);
    }
    expect(applicationSchema.safeParse({ ...base, availability: 'within_week' }).success).toBe(false);
  });

  it('profil kandydata nie przyjmuje wartości tylko-aplikacyjnej (kontrola ujemna)', () => {
    expect(availabilitySchema.safeParse('within_two_weeks').success).toBe(false);
  });
});
