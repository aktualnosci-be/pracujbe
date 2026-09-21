import { z } from 'zod/v3';
import { localeSchema } from '@/lib/validation/auth';
import { availabilitySchema } from '@/lib/validation/candidate';

/**
 * Walidacja aplikacji kandydata na ofertę.
 *
 * Zgodnie z filozofią serwisu (bez CV) list motywacyjny jest opcjonalny — wystarczy zgoda
 * i identyfikator oferty. Opcjonalny idempotencyKey chroni przed podwójnym wysłaniem
 * (APPLICATION_ALREADY_EXISTS).
 *
 * Komunikaty błędów to klucze i18n.
 */
export const applicationSchema = z.object({
  jobId: z
    .string({ required_error: 'application.error.jobRequired' })
    .uuid('application.error.jobInvalid'),
  message: z.string().trim().max(4000, 'application.error.messageTooLong').optional(),
  phone: z
    .string()
    .trim()
    .regex(/^[+]?[0-9\s().-]{6,20}$/, 'application.error.phoneInvalid')
    .optional()
    .or(z.literal('')),
  availability: availabilitySchema.optional(),
  locale: localeSchema.optional(),
  agreeTerms: z.literal(true, {
    errorMap: () => ({ message: 'application.error.termsRequired' }),
  }),
  idempotencyKey: z.string().uuid('application.error.idempotencyKeyInvalid').optional(),
});

export type ApplicationInput = z.infer<typeof applicationSchema>;
