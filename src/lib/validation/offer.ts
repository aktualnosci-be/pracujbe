import { z } from 'zod/v3';
import { localeSchema } from '@/lib/validation/auth';

/**
 * Walidacja bezpośredniej oferty pracodawcy do kandydata (proaktywne "zaproszenie do rozmowy").
 *
 * idempotencyKey chroni przed podwójną wysyłką (OFFER_ALREADY_EXISTS / OFFER_SEND_FAILED) —
 * ten sam klucz => ta sama operacja, bez duplikatów.
 *
 * Komunikaty błędów to klucze i18n.
 */
export const offerSchema = z.object({
  jobId: z.string({ required_error: 'offer.error.jobRequired' }).uuid('offer.error.jobInvalid'),
  candidateId: z
    .string({ required_error: 'offer.error.candidateRequired' })
    .uuid('offer.error.candidateInvalid'),
  message: z
    .string({ required_error: 'offer.error.messageRequired' })
    .trim()
    .min(10, 'offer.error.messageTooShort')
    .max(4000, 'offer.error.messageTooLong')
    // Opcjonalna: bez własnej treści kandydat widzi standardowe zaproszenie w swoim języku (#289).
    .optional(),
  locale: localeSchema.optional(),
  idempotencyKey: z
    .string({ required_error: 'offer.error.idempotencyKeyRequired' })
    .uuid('offer.error.idempotencyKeyInvalid'),
});

export type OfferInput = z.infer<typeof offerSchema>;
