import { z } from 'zod/v3';
import type { Locale } from '@/i18n/routing';

/**
 * Schematy walidacji autoryzacji (logowanie, rejestracja kandydata/pracodawcy, reset hasła).
 *
 * Komunikaty błędów to klucze i18n (np. 'auth.error.emailInvalid'), a nie gotowe teksty UI —
 * warstwa formularza mapuje je na tłumaczenia.
 */

const LOCALE_VALUES = ['pl', 'nl', 'fr', 'en'] as const satisfies readonly Locale[];

export const localeSchema = z.enum(LOCALE_VALUES);

export const emailSchema = z
  .string({ required_error: 'auth.error.emailRequired' })
  .trim()
  .min(1, 'auth.error.emailRequired')
  .email('auth.error.emailInvalid')
  .max(254, 'auth.error.emailTooLong');

export const passwordSchema = z
  .string({ required_error: 'auth.error.passwordRequired' })
  .min(8, 'auth.error.passwordTooShort')
  .max(72, 'auth.error.passwordTooLong')
  .regex(/[A-Za-z]/, 'auth.error.passwordNeedsLetter')
  .regex(/[0-9]/, 'auth.error.passwordNeedsNumber');

const nameSchema = z
  .string({ required_error: 'auth.error.nameRequired' })
  .trim()
  .min(2, 'auth.error.nameTooShort')
  .max(80, 'auth.error.nameTooLong');

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'auth.error.passwordRequired'),
});

export const registerCandidateSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
    firstName: nameSchema,
    lastName: nameSchema,
    locale: localeSchema.optional(),
    agreeTerms: z.literal(true, {
      errorMap: () => ({ message: 'auth.error.termsRequired' }),
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

export const registerEmployerSchema = z
  .object({
    email: emailSchema,
    password: passwordSchema,
    passwordConfirm: z.string().min(1, 'auth.error.passwordConfirmRequired'),
    companyName: z
      .string({ required_error: 'auth.error.companyNameRequired' })
      .trim()
      .min(2, 'auth.error.companyNameTooShort')
      .max(120, 'auth.error.companyNameTooLong'),
    firstName: nameSchema,
    lastName: nameSchema,
    locale: localeSchema.optional(),
    agreeTerms: z.literal(true, {
      errorMap: () => ({ message: 'auth.error.termsRequired' }),
    }),
  })
  .refine((data) => data.password === data.passwordConfirm, {
    path: ['passwordConfirm'],
    message: 'auth.error.passwordMismatch',
  });

export const resetSchema = z.object({
  email: emailSchema,
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterCandidateInput = z.infer<typeof registerCandidateSchema>;
export type RegisterEmployerInput = z.infer<typeof registerEmployerSchema>;
export type ResetInput = z.infer<typeof resetSchema>;
