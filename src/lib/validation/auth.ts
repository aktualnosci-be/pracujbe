import { z } from 'zod/v3';
import { routing } from '@/i18n/routing';
import { minAgeSchema } from '@/lib/age-policy';

/**
 * Schematy walidacji autoryzacji (logowanie, rejestracja kandydata/pracodawcy, reset hasła).
 *
 * Komunikaty błędów to klucze i18n (np. 'auth.error.emailInvalid'), a nie gotowe teksty UI —
 * warstwa formularza mapuje je na tłumaczenia.
 */

export const localeSchema = z.enum(routing.locales);

export const emailSchema = z
  .string({ required_error: 'auth.error.emailRequired' })
  .trim()
  .min(1, 'auth.error.emailRequired')
  .email('auth.error.emailInvalid')
  .max(254, 'auth.error.emailTooLong');

export const passwordSchema = z
  .string({ required_error: 'auth.error.passwordRequired' })
  // Formularz wysyła '' (nie undefined), więc „wymagane” musi być osobnym, pierwszym sprawdzeniem.
  .min(1, 'auth.error.passwordRequired')
  .min(8, 'auth.error.passwordTooShort')
  .max(72, 'auth.error.passwordTooLong')
  .regex(/[A-Za-z]/, 'auth.error.passwordNeedsLetter')
  .regex(/[0-9]/, 'auth.error.passwordNeedsNumber');

const nameSchema = z
  .string({ required_error: 'auth.error.nameRequired' })
  .trim()
  .min(1, 'auth.error.nameRequired')
  .min(2, 'auth.error.nameTooShort')
  .max(80, 'auth.error.nameTooLong');

/**
 * Zgoda na regulamin: wymagane `true`. Celowo NIE `z.literal(true)` — niepoprawny literal jest
 * błędem krytycznym Zod, który wstrzymuje `.refine` całego obiektu, przez co niezgodność haseł
 * wychodziła dopiero po poprawieniu reszty formularza. Błąd niekrytyczny (`fatal: false`)
 * pozwala zgłosić wszystkie problemy w jednej rundzie.
 */
const agreeTermsSchema = z.custom<true>((value) => value === true, {
  message: 'auth.error.termsRequired',
  fatal: false,
});

/**
 * #492: deklaracja „mam co najmniej {minAge} lat” (bez daty urodzenia). Błąd niekrytyczny —
 * jak zgoda na regulamin. `minAge` to próg pokazany w formularzu; baza porównuje go
 * z bieżącym progiem (`candidate_min_age()`), więc wartość od klienta niczego nie obniża.
 */
const ageConfirmedSchema = z.custom<true>((value) => value === true, {
  message: 'auth.error.ageConfirmRequired',
  fatal: false,
});

/** Zgodność haseł; puste powtórzenie ma własny komunikat („Powtórz hasło”). */
function passwordsMatch(data: { password: string; passwordConfirm: string }): boolean {
  return data.passwordConfirm.length === 0 || data.password === data.passwordConfirm;
}

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
    agreeTerms: agreeTermsSchema,
    ageConfirmed: ageConfirmedSchema,
    minAge: minAgeSchema,
  })
  .refine(passwordsMatch, {
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
      .min(1, 'auth.error.companyNameRequired')
      .min(2, 'auth.error.companyNameTooShort')
      .max(120, 'auth.error.companyNameTooLong'),
    firstName: nameSchema,
    lastName: nameSchema,
    locale: localeSchema.optional(),
    agreeTerms: agreeTermsSchema,
  })
  .refine(passwordsMatch, {
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

