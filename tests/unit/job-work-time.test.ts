// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { buildDraftStepContent } from '@/lib/job-draft-content';
import { step2Schema } from '@/lib/validation/job';

/**
 * #811 (0194): wymiar pracy w kreatorze oferty — zapis kroku 2 (`save_job_draft`, klucz
 * `work_time`), brak wyboru = brak deklaracji (null czyści wartość), wartość spoza listy
 * odrzuca walidacja (i CHECK `jobs_work_time_check` w bazie — rls.sql FL974-7).
 */
const base = { contractType: 'permanent', workingHours: '20 godzin tygodniowo', startImmediately: false };

describe('#811 wymiar pracy w kreatorze', () => {
  it('krok 2 zapisuje wybrany wymiar jako work_time', () => {
    const parsed = step2Schema.parse({ ...base, workTime: 'part_time' });
    expect(buildDraftStepContent(2, parsed)).toMatchObject({ job: { work_time: 'part_time' } });
  });

  it('brak wyboru = null (czyści zapisaną deklarację, nie zgaduje z opisu godzin)', () => {
    const parsed = step2Schema.parse(base);
    expect((buildDraftStepContent(2, parsed) as { job: Record<string, unknown> }).job['work_time']).toBeNull();
  });

  it('kontrola ujemna: wartość spoza listy odrzucona', () => {
    expect(step2Schema.safeParse({ ...base, workTime: 'weekend' }).success).toBe(false);
    expect(step2Schema.safeParse({ ...base, workTime: 'both' }).success).toBe(true);
  });
});
