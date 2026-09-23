import { z } from 'zod/v3';

/**
 * Walidacja danych firmy pracodawcy (Etap 4).
 *
 * Dwa pola edytowalne przez właściciela lub administratora firmy: nazwa (wymagana) oraz numer VAT/KBO
 * (opcjonalny; belgijski numer przedsiębiorstwa KBO/BCE albo pusty). Status weryfikacji
 * NIE jest częścią tego schematu — nadaje go wyłącznie administrator (RPC + trigger DB).
 *
 * Komunikaty błędów to klucze i18n (namespace `company.error.*`) — tłumaczone w formularzu.
 */

const nameSchema = z
  .string({ required_error: 'company.error.nameRequired' })
  .trim()
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
