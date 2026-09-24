import { z } from 'zod/v3';

import { GUEST_EMAIL_MAX, GUEST_MESSAGE_MAX, GUEST_NAME_MAX } from '@/lib/guest-apply/limits';
import { localeSchema } from '@/lib/validation/auth';
import {
  APPLICATION_AVAILABILITY_VALUES,
  screeningAnswersSchema,
  withoutPersonalIdentifier,
} from '@/lib/validation/application';

/**
 * Walidacja jednorazowej aplikacji bez konta (#98). Minimalne dane: imię i nazwisko, e-mail,
 * zgoda na przetwarzanie danych; telefon, dostępność i wiadomość są opcjonalne. Telefon
 * waliduje osobno `applicationPhoneSchema` (ten sam format E.164 co w zwykłej aplikacji).
 * Komunikaty błędów to klucze i18n.
 */
export const guestApplicationSchema = z.object({
  jobId: z.string().uuid('guestApply.error.jobInvalid'),
  fullName: z
    .string({ required_error: 'guestApply.error.nameRequired' })
    .trim()
    .min(1, 'guestApply.error.nameRequired')
    .max(GUEST_NAME_MAX, 'guestApply.error.nameTooLong'),
  email: z
    .string({ required_error: 'guestApply.error.emailRequired' })
    .trim()
    .min(1, 'guestApply.error.emailRequired')
    .email('guestApply.error.emailInvalid')
    .max(GUEST_EMAIL_MAX, 'guestApply.error.emailInvalid')
    .transform((value) => value.toLowerCase()),
  availability: z.enum(APPLICATION_AVAILABILITY_VALUES).optional(),
  // #495: bez NISS/BIS i numerów dokumentów (jak w zwykłej aplikacji).
  message: withoutPersonalIdentifier(
    z.string().trim().max(GUEST_MESSAGE_MAX, 'guestApply.error.messageTooLong').optional(),
    'guestApply.error.sensitiveIdNotAllowed',
  ),
  locale: localeSchema,
  agreeTerms: z.literal(true, { errorMap: () => ({ message: 'guestApply.error.consentRequired' }) }),
  idempotencyKey: z.string().uuid('guestApply.error.idempotencyKeyInvalid'),
  /**
   * #101: odpowiedzi na pytania oferty — ten sam kształt co w zwykłej aplikacji. Wymagalność,
   * typ i opcje sprawdza baza (`record_screening_answers`) przy wysłaniu zgłoszenia.
   */
  answers: screeningAnswersSchema('guestApply.error.sensitiveIdNotAllowed'),
});

export type GuestApplicationInput = z.input<typeof guestApplicationSchema> & {
  phone?: string;
  phoneCountry?: string;
};
