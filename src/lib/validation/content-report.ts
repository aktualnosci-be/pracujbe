import { z } from 'zod/v3';

import { routing } from '@/i18n/routing';

/**
 * Walidacja publicznego zgłoszenia treści (DSA, #41) — ten sam schemat w formularzu
 * (React Hook Form) i w Server Action. Reguły lustrzane do `submit_content_report` (0095);
 * baza sprawdza je ponownie, więc ominięcie formularza niczego nie daje.
 *
 * Komunikaty błędów to klucze i18n (`contentReport.error.*`), tłumaczone w formularzu.
 *
 * Katalog kategorii jest TYMCZASOWY — do potwierdzenia w mapie obowiązków DSA (#40).
 */

/** Kategorie zgłoszenia (kolejność = kolejność w formularzu). Zgodne z CHECK w 0095. */
export const REPORT_CATEGORIES = [
  'fraud',
  'impersonation',
  'discrimination',
  'illegal_conditions',
  'data_misuse',
  'other',
] as const;
export type ReportCategory = (typeof REPORT_CATEGORIES)[number];

/** Co jest zgłaszane: konkretna oferta albo firma, która ją opublikowała. */
export const REPORT_TARGETS = ['job', 'company'] as const;
export type ReportTarget = (typeof REPORT_TARGETS)[number];

/** Limity pól (= ograniczenia w bazie). */
export const REPORT_LIMITS = {
  detailsMin: 20,
  detailsMax: 5000,
  nameMax: 200,
  emailMax: 254,
  urlMax: 2000,
} as const;

/** Kod dostępu do sprawy: 24 znaki base32 (120 bitów), generowany w przeglądarce zgłaszającego. */
export const ACCESS_CODE_RE = /^[A-Z2-7]{24}$/;
/** Numer sprawy nadawany przez bazę. */
export const CASE_NUMBER_RE = /^DSA-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Nowy kod dostępu (Web Crypto — przeglądarka i Node). */
export function generateAccessCode(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  // 256 jest wielokrotnością 32 — `% 32` nie zaburza rozkładu.
  return Array.from(bytes, (b) => BASE32[b % 32]).join('');
}

/** Kod w grupach po 4 znaki (czytelność); wpisany z myślnikami/spacjami — normalizowany. */
export function formatAccessCode(code: string): string {
  return code.replace(/(.{4})(?=.)/g, '$1-');
}

export function normalizeAccessCode(value: string): string {
  return value.toUpperCase().replace(/[\s-]/g, '');
}

export function normalizeCaseNumber(value: string): string {
  return value.trim().toUpperCase();
}

export const contentReportSchema = z.object({
  target: z.enum(REPORT_TARGETS),
  // Identyfikator oferty z publicznej strony; format UUID sprawdza akcja (nie-UUID = brak treści).
  jobId: z.string().min(1).max(100),
  category: z.enum(REPORT_CATEGORIES, {
    errorMap: () => ({ message: 'contentReport.error.categoryRequired' }),
  }),
  details: z
    .string()
    .trim()
    .min(1, 'contentReport.error.detailsRequired')
    .min(REPORT_LIMITS.detailsMin, 'contentReport.error.detailsTooShort')
    .max(REPORT_LIMITS.detailsMax, 'contentReport.error.detailsTooLong'),
  contentUrl: z
    .string()
    .trim()
    .max(REPORT_LIMITS.urlMax, 'contentReport.error.urlInvalid')
    .refine((v) => v === '' || /^https?:\/\/\S+$/i.test(v), 'contentReport.error.urlInvalid'),
  reporterName: z.string().trim().max(REPORT_LIMITS.nameMax, 'contentReport.error.nameTooLong'),
  reporterEmail: z
    .string()
    .trim()
    .min(1, 'contentReport.error.emailRequired')
    .max(REPORT_LIMITS.emailMax, 'contentReport.error.emailInvalid')
    .email('contentReport.error.emailInvalid'),
  goodFaith: z.custom<true>((value) => value === true, {
    message: 'contentReport.error.goodFaithRequired',
    fatal: false,
  }),
  locale: z.enum(routing.locales),
  idempotencyKey: z.string().uuid(),
  accessCode: z.string().regex(ACCESS_CODE_RE),
});

export type ContentReportInput = z.input<typeof contentReportSchema>;

/** Pola formularza (bez identyfikatorów operacji — te trzyma komponent). */
export const contentReportFormSchema = contentReportSchema.omit({
  target: true,
  jobId: true,
  locale: true,
  idempotencyKey: true,
  accessCode: true,
});
export type ContentReportFormValues = z.input<typeof contentReportFormSchema>;

export const reportCaseLookupSchema = z.object({
  caseNumber: z
    .string()
    .transform(normalizeCaseNumber)
    .refine((v) => v.length > 0, 'contentReport.error.caseNumberRequired')
    .refine((v) => v.length === 0 || CASE_NUMBER_RE.test(v), 'contentReport.error.caseNumberInvalid'),
  accessCode: z
    .string()
    .transform(normalizeAccessCode)
    .refine((v) => v.length > 0, 'contentReport.error.accessCodeRequired')
    .refine((v) => v.length === 0 || ACCESS_CODE_RE.test(v), 'contentReport.error.accessCodeInvalid'),
});
export type ReportCaseLookupInput = z.input<typeof reportCaseLookupSchema>;
