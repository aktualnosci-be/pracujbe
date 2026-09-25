import { z } from 'zod/v3';

/**
 * Zgłoszenie wiadomości albo całej rozmowy (Etap 5, migracja 0116).
 *
 * Słownik powodów i limit opisu = te same wartości co w RPC `report_conversation_content`
 * i ograniczeniu `reports_message_report_complete` (test porównuje je z migracją).
 * Akcja nie pokazuje komunikatów Zod — przy błędzie zwraca `VALIDATION_FAILED` (Invariant #8).
 */
export const MESSAGE_REPORT_CATEGORIES = [
  'spam',
  'harassment',
  'fraud',
  'discrimination',
  'inappropriate',
  'data_misuse',
  'other',
] as const;

export type MessageReportCategory = (typeof MESSAGE_REPORT_CATEGORIES)[number];

export const MESSAGE_REPORT_DETAILS_MAX = 1000;

export const messageReportSchema = z.object({
  conversationId: z.string().uuid(),
  /** `null` = zgłoszenie całej rozmowy. */
  messageId: z.string().uuid().nullable(),
  category: z.enum(MESSAGE_REPORT_CATEGORIES),
  details: z
    .string()
    .trim()
    .max(MESSAGE_REPORT_DETAILS_MAX)
    .transform((value) => (value.length > 0 ? value : null)),
  idempotencyKey: z.string().uuid(),
});

export type MessageReportInput = z.input<typeof messageReportSchema>;
