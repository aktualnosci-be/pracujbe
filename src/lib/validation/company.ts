import { z } from 'zod/v3';

import { COMPANY_URL_MAX_LENGTH, isPublicHttpsUrl } from '@/lib/company-links';

/**
 * Walidacja danych firmy pracodawcy (Etap 4).
 *
 * Dwa pola edytowalne przez właściciela lub administratora firmy: nazwa (wymagana) oraz numer VAT/KBO
 * (opcjonalny; belgijski numer przedsiębiorstwa KBO/BCE albo pusty). Status weryfikacji
 * NIE jest częścią tego schematu — nadaje go wyłącznie administrator (RPC + trigger DB).
 *
 * Strona WWW i logo (`companyLinksSchema`, #112) — osobny, mniejszy formularz w tym samym
 * panelu: adres bezwzględny https, ta sama reguła co w bazie (`isPublicHttpsUrl`, lustro
 * `public_https_url`); zmiana tych pól NIE cofa weryfikacji firmy (w przeciwieństwie do
 * nazwy/VAT — patrz `protect_company_verification`, 0072/0141).
 *
 * Komunikaty błędów to klucze i18n (namespace `company.error.*`) — tłumaczone w formularzu.
 */

const nameSchema = z
  .string({ required_error: 'company.error.nameRequired' })
  .trim()
  // Pusty string (formularz wysyła '') → „wymagane", „za krótka" dopiero dla 1 znaku (#367).
  .min(1, 'company.error.nameRequired')
  .min(2, 'company.error.nameTooShort')
  .max(120, 'company.error.nameTooLong');

// Lenient: pozwala na 2-literowy prefiks kraju + cyfry/kropki/spacje/myślniki (BE0123.456.789,
// BE 0123456789, 0123456789). Puste = brak numeru. Twarda walidacja KBO/BCE = weryfikacja admina.
const vatSchema = z
  .string()
  .trim()
  .max(20, 'company.error.vatTooLong')
  .regex(/^[A-Za-z0-9][A-Za-z0-9.\s-]{6,18}$/, 'company.error.vatInvalid')
  .optional()
  .or(z.literal(''));

/** Pełny formularz firmy (create/edit po stronie klienta) — nazwa wymagana. */
export const companyFormSchema = z.object({
  name: nameSchema,
  vatNumber: vatSchema,
});

/** Aktualizacja częściowa (server) — walidowane tylko pola obecne w wejściu. */
export const companyUpdateSchema = companyFormSchema.partial();

export type CompanyFormInput = z.infer<typeof companyFormSchema>;
export type CompanyUpdateInput = z.infer<typeof companyUpdateSchema>;

/**
 * Bezwzględny adres https albo pusty tekst (czyszczenie pola) — ta sama reguła co
 * `public.public_https_url` w bazie (`src/lib/company-links.ts`).
 */
const publicHttpsUrlSchema = z
  .string()
  .trim()
  .max(COMPANY_URL_MAX_LENGTH, 'company.error.urlTooLong')
  .refine((v) => v === '' || isPublicHttpsUrl(v), 'company.error.urlInvalid')
  .optional()
  .or(z.literal(''));

/** Strona WWW i adres logo firmy (#112) — oba pola opcjonalne, edytowalne niezależnie. */
export const companyLinksSchema = z.object({
  website: publicHttpsUrlSchema,
  logoUrl: publicHttpsUrlSchema,
});

/** Aktualizacja częściowa (server) — jak `companyUpdateSchema`. */
export const companyLinksUpdateSchema = companyLinksSchema.partial();

export type CompanyLinksInput = z.infer<typeof companyLinksSchema>;
export type CompanyLinksUpdateInput = z.infer<typeof companyLinksUpdateSchema>;
