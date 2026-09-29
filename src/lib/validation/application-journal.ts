import { z } from 'zod/v3';

/**
 * Dziennik aplikacji kandydata (#904, 0970) — wspólne reguły pól dla formularza i akcji.
 * Baza (RPC `save_application_journal_entry` + CHECK-i) egzekwuje te same limity niezależnie
 * od tego modułu.
 */

export const JOURNAL_STAGES = ['planned', 'sent', 'interview', 'offer', 'closed'] as const;
export type JournalStage = (typeof JOURNAL_STAGES)[number];

export const JOURNAL_LIMITS = { title: 160, company: 160, url: 500, location: 120, note: 2000, entries: 200 } as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/** Poprawna data kalendarzowa `RRRR-MM-DD` (odrzuca np. 2026-02-31). */
export function isValidYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Adres https z hostem zawierającym kropkę, bez spacji i znaków cudzysłowu/nawiasów. */
export function isJournalHttpsUrl(value: string): boolean {
  if (value.length > JOURNAL_LIMITS.url || /[\s"'<>]/.test(value)) return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname.includes('.');
  } catch {
    return false;
  }
}

export const journalFieldNames = [
  'jobTitle',
  'companyName',
  'sourceUrl',
  'location',
  'appliedOn',
  'stage',
  'note',
  'remindOn',
] as const;
export type JournalFieldName = (typeof journalFieldNames)[number];

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => (v ? v : null));

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : null))
  .refine((v) => v === null || isValidYmd(v));

export const journalEntrySchema = z.object({
  jobTitle: z.string().trim().min(1).max(JOURNAL_LIMITS.title),
  companyName: z.string().trim().min(1).max(JOURNAL_LIMITS.company),
  sourceUrl: z
    .string()
    .trim()
    .max(JOURNAL_LIMITS.url)
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || isJournalHttpsUrl(v)),
  location: optionalText(JOURNAL_LIMITS.location),
  appliedOn: optionalDate,
  stage: z.enum(JOURNAL_STAGES),
  note: optionalText(JOURNAL_LIMITS.note),
  remindOn: optionalDate,
});

export type JournalEntryInput = z.input<typeof journalEntrySchema>;
export type JournalEntryValues = z.output<typeof journalEntrySchema>;
