import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';
import { SCREENING_LIMITS, SCREENING_QUESTION_TYPES } from '@/lib/screening/questions';

/**
 * Walidacja pytań screeningowych w kreatorze oferty (#101). Te same reguły co RPC
 * `set_job_screening_questions` (0094): maks. 10 pytań, typ z listy, treść ≤ 300 znaków,
 * pytanie wyboru 2–10 opcji ≤ 120 znaków, tekst w języku treści oferty wymagany. Baza sprawdza
 * to samo — walidacja tu daje komunikat przy polu zamiast ogólnego błędu zapisu.
 *
 * Komunikaty błędów to klucze i18n.
 */

const localeKey = z.enum(routing.locales);

const localizedTextSchema = (max: number, tooLong: string) =>
  z.record(localeKey, z.string().trim().max(max, tooLong)).default({});

export const screeningQuestionSchema = z
  .object({
    type: z.enum(SCREENING_QUESTION_TYPES, {
      errorMap: () => ({ message: 'job.error.screeningTypeInvalid' }),
    }),
    required: z.boolean().default(false),
    prompt: localizedTextSchema(SCREENING_LIMITS.prompt, 'job.error.screeningPromptTooLong'),
    options: z
      .array(
        z.object({
          label: localizedTextSchema(SCREENING_LIMITS.option, 'job.error.screeningOptionTooLong'),
        }),
      )
      .max(SCREENING_LIMITS.optionsMax, 'job.error.screeningOptionsCount')
      .default([]),
  })
  .superRefine((question, ctx) => {
    if (question.type === 'single_choice' && question.options.length < SCREENING_LIMITS.optionsMin) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['options'],
        message: 'job.error.screeningOptionsCount',
      });
    }
  });

export const screeningQuestionsSchema = z
  .array(screeningQuestionSchema)
  .max(SCREENING_LIMITS.questions, 'job.error.screeningTooMany')
  .default([]);

export type ScreeningQuestionInput = z.infer<typeof screeningQuestionSchema>;

/**
 * Tekst w języku treści oferty jest wymagany dla treści pytania i każdej opcji wyboru.
 * Ścieżki błędów: `screeningQuestions.<i>.prompt` / `screeningQuestions.<i>.options.<j>`.
 */
export function refineScreeningPrimaryLocale(
  questions: ScreeningQuestionInput[],
  primaryLocale: string | undefined,
  ctx: z.RefinementCtx,
): void {
  if (!primaryLocale) return;
  const key = primaryLocale as (typeof routing.locales)[number];
  questions.forEach((question, index) => {
    if (!question.prompt[key]?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['screeningQuestions', index, 'prompt'],
        message: 'job.error.screeningPromptRequired',
      });
    }
    if (question.type !== 'single_choice') return;
    question.options.forEach((option, optionIndex) => {
      if (!option.label[key]?.trim()) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['screeningQuestions', index, 'options', optionIndex],
          message: 'job.error.screeningOptionRequired',
        });
      }
    });
  });
}
