import { z } from 'zod/v3';
import { localeSchema } from '@/lib/validation/locale';
import { AVAILABILITY_VALUES } from '@/lib/validation/candidate';
import { normalizePhone, PHONE_COUNTRIES } from '@/lib/validation/phone';
import { SCREENING_LIMITS } from '@/lib/screening/questions';
import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';

/**
 * Walidacja aplikacji kandydata na ofertę.
 *
 * Zgodnie z filozofią serwisu (bez CV) list motywacyjny jest opcjonalny — wystarczy zgoda
 * i identyfikator oferty. Opcjonalny idempotencyKey chroni przed podwójnym wysłaniem
 * (APPLICATION_ALREADY_EXISTS).
 *
 * Telefon (#145): numer krajowy + wybrany kraj (`phoneCountry`) albo pełny numer
 * międzynarodowy. Po walidacji `phone` ma kanoniczny format E.164 (`normalizePhone`).
 *
 * Komunikaty błędów to klucze i18n.
 */
/**
 * #495: na etapie aplikacji nie zbieramy NISS/BIS, PESEL ani numerów dokumentów tożsamości.
 * Tekst wpisany przez kandydata (wiadomość do firmy, odpowiedzi na pytania) z takim numerem
 * jest odrzucany z komunikatem przy polu — nic nie jest zapisywane.
 */
export const SENSITIVE_ID_MESSAGE_KEY = 'application.error.sensitiveIdNotAllowed';

/** Tekst bez numerów identyfikacyjnych (`containsPersonalIdentifier`). */
export function withoutPersonalIdentifier<T extends z.ZodType<string | undefined>>(schema: T, message: string) {
  return schema.refine((value) => !containsPersonalIdentifier(value), { message });
}

/** Odpowiedzi na pytania oferty (#101) — kształt, sufity i brak numerów identyfikacyjnych. */
export function screeningAnswersSchema(sensitiveMessage: string) {
  return z
    .record(
      z.string().uuid(),
      z.union([
        z.boolean(),
        withoutPersonalIdentifier(z.string().trim().max(SCREENING_LIMITS.answer), sensitiveMessage),
      ]),
    )
    .refine((value) => Object.keys(value).length <= SCREENING_LIMITS.questions)
    .optional();
}

/**
 * Miejsce numeru identyfikacyjnego w danych formularza (sprawdzane przed resztą, także
 * w trybie demo): wiadomość albo pytanie screeningowe. `null` = brak.
 */
export function findPersonalIdentifierField(input: {
  message?: string | null;
  answers?: Record<string, unknown> | null;
}): { field: 'message' } | { questionId: string } | null {
  if (containsPersonalIdentifier(input.message)) return { field: 'message' };
  for (const [questionId, value] of Object.entries(input.answers ?? {})) {
    if (typeof value === 'string' && containsPersonalIdentifier(value)) return { questionId };
  }
  return null;
}

const phoneFields = z.object({
  phone: z.string().trim().max(64, 'application.error.phoneInvalid').optional(),
  phoneCountry: z.enum(PHONE_COUNTRIES).optional(),
});

function withNormalizedPhone<T extends z.infer<typeof phoneFields>>(
  value: T,
  ctx: z.RefinementCtx,
): T {
  if (!value.phone) return { ...value, phone: undefined };
  const phone = normalizePhone(value.phone, value.phoneCountry);
  if (!phone) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['phone'],
      message: 'application.error.phoneInvalid',
    });
    return z.NEVER;
  }
  return { ...value, phone };
}

/**
 * Dostępność w aplikacji: wartości profilu + „w ciągu 2 tygodni" (#190, enum 0074).
 * Profil kandydata zachowuje węższy zestaw (AVAILABILITY_VALUES).
 */
type AvailabilityValue = (typeof AVAILABILITY_VALUES)[number];
export const APPLICATION_AVAILABILITY_VALUES = [
  'immediate',
  'within_two_weeks',
  'within_month',
  'within_three_months',
  'flexible',
] as const satisfies readonly (AvailabilityValue | 'within_two_weeks')[];
export type ApplicationAvailability = (typeof APPLICATION_AVAILABILITY_VALUES)[number];
const applicationAvailabilitySchema = z.enum(APPLICATION_AVAILABILITY_VALUES);

/** Opcje dostępności w formularzu aplikowania (ApplyModal). */
export const APPLY_AVAILABILITY_OPTIONS = ['immediate', 'twoWeeks', 'oneMonth', 'flexible'] as const;
export type ApplyAvailabilityOption = (typeof APPLY_AVAILABILITY_OPTIONS)[number];

/**
 * Opcja formularza → wartość enuma `availability_status` (0001, 0074). Każda widoczna
 * opcja zapisuje rozróżnialną wartość (#190).
 */
export const APPLY_AVAILABILITY_TO_DB: Record<ApplyAvailabilityOption, ApplicationAvailability> = {
  immediate: 'immediate',
  twoWeeks: 'within_two_weeks',
  oneMonth: 'within_month',
  flexible: 'flexible',
};

/** Sam telefon — sprawdzany przed resztą, aby błąd trafił do pola (także w trybie demo). */
export const applicationPhoneSchema = phoneFields.transform(withNormalizedPhone);

export const applicationSchema = z
  .object({
    jobId: z
      .string({ required_error: 'application.error.jobRequired' })
      .uuid('application.error.jobInvalid'),
    message: withoutPersonalIdentifier(
      z.string().trim().max(4000, 'application.error.messageTooLong').optional(),
      SENSITIVE_ID_MESSAGE_KEY,
    ),
    availability: applicationAvailabilitySchema.optional(),
    locale: localeSchema.optional(),
    agreeTerms: z.literal(true, {
      errorMap: () => ({ message: 'application.error.termsRequired' }),
    }),
    idempotencyKey: z.string().uuid('application.error.idempotencyKeyInvalid').optional(),
    /**
     * #101: odpowiedzi na pytania oferty (id pytania → tak/nie albo tekst). Wymagalność, typ
     * i opcje sprawdza `apply_to_job` w bazie — tu tylko kształt i sufity rozmiaru.
     */
    answers: screeningAnswersSchema(SENSITIVE_ID_MESSAGE_KEY),
  })
  .merge(phoneFields)
  .transform(withNormalizedPhone);

export type ApplicationInput = z.input<typeof applicationSchema>;
