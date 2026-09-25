import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { applyToJob } from '@/lib/actions/applications';
import { fakeDb, pgError, resetFakeDb } from '../helpers/fake-db';
import {
  localizedText,
  parseScreeningAnswers,
  SCREENING_LIMITS,
} from '@/lib/screening/questions';
import { step7Schema } from '@/lib/validation/job';
import { screeningErrorKey } from '@/components/employer/ScreeningQuestionsEditor';

/**
 * #101 — pytania screeningowe. Walidacja w bazie (wymagane odpowiedzi, szkic, RLS) jest
 * dowodzona w `rls.sql` sekcja SQ101; tu: limity klienta = limity migracji, komunikaty przy
 * polach kreatora, odpowiedzi przekazane do `apply_to_job` i błąd bazy przy pytaniu.
 */

vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: vi.fn(async () => true) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/0093_screening_questions.sql'),
  'utf8',
);

const STEP7 = {
  requirementsOptional: [],
  skills: [],
  languages: [],
  requiredCertificates: [],
  requiresDrivingLicense: false,
  noLanguageRequired: false,
  screeningLocale: 'pl',
};

function issues(screeningQuestions: unknown[]): { key: string; message: string }[] {
  const result = step7Schema.safeParse({ ...STEP7, screeningQuestions });
  if (result.success) return [];
  return result.error.issues
    .filter((issue) => issue.path[0] === 'screeningQuestions')
    .map((issue) => ({ key: screeningErrorKey(issue.path.slice(1)), message: issue.message }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: '55555555-5555-4555-8555-555555555555', role: 'candidate' });
  fakeDb.rpc('apply_to_job', 'application-1');
});

describe('limity pytań = limity migracji 0093', () => {
  it('liczba pytań, długość treści, opcji i odpowiedzi', () => {
    expect(MIGRATION).toContain(`jsonb_array_length(p_questions) > ${SCREENING_LIMITS.questions}`);
    expect(MIGRATION).toContain(`position between 0 and ${SCREENING_LIMITS.questions - 1}`);
    expect(MIGRATION).toContain(`screening_text_map(q->'prompt', v_locale, ${SCREENING_LIMITS.prompt})`);
    expect(MIGRATION).toContain(`screening_text_map(o->'label', v_locale, ${SCREENING_LIMITS.option})`);
    expect(MIGRATION).toContain(
      `not between ${SCREENING_LIMITS.optionsMin} and ${SCREENING_LIMITS.optionsMax}`,
    );
    expect(MIGRATION).toContain(`length(v_text) > ${SCREENING_LIMITS.answer}`);
  });
});

describe('krok 7 kreatora — walidacja pytań przy polach', () => {
  it('poprawne pytania każdego typu przechodzą', () => {
    expect(
      issues([
        { type: 'yes_no', required: true, prompt: { pl: 'Prawo jazdy?' } },
        { type: 'single_choice', prompt: { pl: 'Dojazd' }, options: [{ label: { pl: 'Auto' } }, { label: { pl: 'Bus' } }] },
        { type: 'date', prompt: { pl: 'Od kiedy?', en: 'Since when?' } },
        { type: 'short_text', prompt: { pl: 'Doświadczenie' } },
      ]),
    ).toEqual([]);
  });

  it('brak treści w języku oferty → błąd przy treści pytania i przy opcji', () => {
    expect(
      issues([
        { type: 'yes_no', prompt: { en: 'Only English' } },
        { type: 'single_choice', prompt: { pl: 'Dojazd' }, options: [{ label: { pl: 'Auto' } }, { label: { nl: 'Bus' } }] },
      ]),
    ).toEqual([
      { key: '0.prompt', message: 'job.error.screeningPromptRequired' },
      { key: '1.options.1', message: 'job.error.screeningOptionRequired' },
    ]);
  });

  it('za długa treść, za mało opcji i za dużo pytań', () => {
    expect(issues([{ type: 'short_text', prompt: { pl: 'x'.repeat(SCREENING_LIMITS.prompt + 1) } }])).toEqual([
      { key: '0.prompt.pl', message: 'job.error.screeningPromptTooLong' },
    ]);
    expect(issues([{ type: 'single_choice', prompt: { pl: 'Dojazd' }, options: [{ label: { pl: 'Auto' } }] }])).toEqual([
      { key: '0.options', message: 'job.error.screeningOptionsCount' },
    ]);
    const many = Array.from({ length: SCREENING_LIMITS.questions + 1 }, () => ({ type: 'yes_no', prompt: { pl: 'P' } }));
    expect(issues(many)).toEqual([{ key: '', message: 'job.error.screeningTooMany' }]);
  });
});

describe('tekst pytania w języku widza', () => {
  it('język strony → język treści oferty → pierwszy dostępny', () => {
    const text = { pl: 'Pytanie', fr: 'Question' };
    expect(localizedText(text, 'fr', 'pl')).toBe('Question');
    expect(localizedText(text, 'nl', 'pl')).toBe('Pytanie');
    expect(localizedText({ fr: 'Question' }, 'nl', 'en')).toBe('Question');
  });

  it('snapshot odpowiedzi z bazy zachowuje kolejność i typy wartości', () => {
    expect(
      parseScreeningAnswers([
        { position: 1, type: 'date', required: false, prompt: { pl: 'Od kiedy?' }, options: [], answer_boolean: null, answer_date: '2026-10-01', answer_text: null },
        { position: 0, type: 'yes_no', required: true, prompt: { pl: 'C+E?' }, options: [], answer_boolean: false, answer_date: null, answer_text: null },
      ]),
    ).toEqual([
      { position: 0, type: 'yes_no', required: true, prompt: { pl: 'C+E?' }, options: [], answerBoolean: false, answerDate: null, answerText: null },
      { position: 1, type: 'date', required: false, prompt: { pl: 'Od kiedy?' }, options: [], answerBoolean: null, answerDate: '2026-10-01', answerText: null },
    ]);
  });
});

describe('applyToJob — odpowiedzi w tym samym wywołaniu co aplikacja', () => {
  const input = {
    jobId: '11111111-1111-4111-8111-111111111111',
    agreeTerms: true as const,
    idempotencyKey: '22222222-2222-4222-8222-222222222222',
  };
  const Q1 = '33333333-3333-4333-8333-333333333333';
  const Q2 = '44444444-4444-4444-8444-444444444444';

  it('przekazuje odpowiedzi do apply_to_job (jedna transakcja w bazie)', async () => {
    expect(await applyToJob({ ...input, answers: { [Q1]: true, [Q2]: ' o2 ' } })).toEqual({
      ok: true,
      id: 'application-1',
    });
    expect(fakeDb.calls).toHaveLength(1);
    const { args } = fakeDb.callsTo('apply_to_job')[0]!;
    // jsonb: obiekt wysłany jako JSON (nie literał PG).
    expect(JSON.parse(args['p_answers'] as string)).toEqual({ [Q1]: true, [Q2]: 'o2' });
    expect(args['p_idempotency_key']).toBe(input.idempotencyKey);
  });

  it('bez odpowiedzi → p_answers null (oferta bez pytań jak dotąd)', async () => {
    await applyToJob(input);
    expect(fakeDb.callsTo('apply_to_job')[0]!.args).toMatchObject({ p_answers: null });
  });

  it('brak odpowiedzi na pytanie wymagane (baza) → kod użytkowy i id pytania, bez tekstu bazy', async () => {
    fakeDb.rpc('apply_to_job', () => { throw pgError('P0001', `SCREENING_ANSWER_REQUIRED: ${Q2}`); });
    expect(await applyToJob(input)).toEqual({
      ok: false,
      error: 'SCREENING_ANSWER_REQUIRED',
      questionId: Q2,
    });
  });

  it('odpowiedź dłuższa niż limit nie dociera do bazy', async () => {
    expect(await applyToJob({ ...input, answers: { [Q1]: 'x'.repeat(SCREENING_LIMITS.answer + 1) } })).toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
