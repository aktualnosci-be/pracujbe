import { z } from 'zod/v3';

/**
 * Pytania asystenta profilu (#37, „profil z odpowiedzi”). Kandydat odpowiada własnymi słowami
 * na kilka prostych pytań — bez CV. Moduł czysty (także dla przeglądarki): identyfikatory
 * pytań, limity i schemat wejścia akcji.
 */

export const PROFILE_QUESTION_IDS = ['work', 'skills', 'languages', 'certificates'] as const;
export type ProfileQuestionId = (typeof PROFILE_QUESTION_IDS)[number];

/** Limit znaków jednej odpowiedzi (licznik w formularzu = walidacja serwera). */
export const PROFILE_ANSWER_MAX = 1000;
/** Minimum treści łącznie (bez białych znaków) — krótsze odpowiedzi nie trafiają do modelu. */
export const PROFILE_ANSWERS_MIN_CHARS = 20;

/** Ścisły schemat wejścia: tylko znane pytania, każde ≤ limitu. Inne klucze = odrzucenie. */
export const profileAnswersSchema = z
  .object(
    Object.fromEntries(PROFILE_QUESTION_IDS.map((id) => [id, z.string().max(PROFILE_ANSWER_MAX).optional()])) as Record<
      ProfileQuestionId,
      z.ZodOptional<z.ZodString>
    >,
  )
  .strict();

export type ProfileAnswers = Partial<Record<ProfileQuestionId, string>>;

/** Opis pytania dla modelu (po angielsku — instrukcje, nie treść kandydata). */
export const PROFILE_QUESTION_TOPICS: Record<ProfileQuestionId, string> = {
  work: 'Recent jobs: where and as what the person worked, what they did, for how long',
  skills: 'What the person is good at: tasks, machines, tools',
  languages: 'Languages the person speaks and how well',
  certificates: 'Certificates, licences, permits, driving licence categories',
};
