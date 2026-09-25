'use server';

import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/error-report';
import { messageReportSchema, type MessageReportInput } from '@/lib/validation/message-report';

/**
 * Zgłoszenie wiadomości albo całej rozmowy przez jej stronę (Etap 5, migracja 0116).
 *
 * Cienka warstwa nad RPC `report_conversation_content` wołanym POD SESJĄ: uczestnictwo
 * (strona firmowa = aktywny recruiter+), dowód z treścią tylko zgłoszonej wiadomości,
 * idempotencja po `idempotencyKey`, jedna otwarta sprawa na wiadomość i limit dobowy —
 * w bazie. Tu: walidacja wejścia, limiter aplikacyjny (per konto) i mapowanie błędu na
 * kod użytkowy (Invariant #8). Dowód czyta wyłącznie panel administratora.
 */

export type MessageReportOutcome = 'created' | 'duplicate' | 'already_open';

export type MessageReportResult =
  | { ok: true; outcome: MessageReportOutcome }
  | { ok: false; error: ErrorCode };

const OUTCOMES: readonly MessageReportOutcome[] = ['created', 'duplicate', 'already_open'];

function mapPgError(message: string): ErrorCode {
  if (message.includes('RATE_LIMITED')) return 'RATE_LIMITED';
  if (message.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (message.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (message.includes('PERMISSION_DENIED') || message.includes('UNAUTHENTICATED')) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

export async function reportConversationContent(
  input: MessageReportInput,
): Promise<MessageReportResult> {
  // Tryb demo (rozmowy z identyfikatorami demo, bez bazy): nic nie zapisujemy — UI pokazuje
  // stan „zgłoszono” po poprawnym powodzie i opisie.
  if (!isPortalDataConfigured()) {
    return messageReportSchema.pick({ category: true, details: true }).safeParse(input).success
      ? { ok: true, outcome: 'created' }
      : { ok: false, error: 'VALIDATION_FAILED' };
  }

  const parsed = messageReportSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };

    if (!(await checkRateLimit('message-report', { max: 10, windowSeconds: 3600, identifier: me.id, perIp: false }))) {
      return { ok: false, error: 'RATE_LIMITED' };
    }

    const data = await withPortalTransaction(me, (tx) =>
      rpc<{ report_id: string | null; outcome: string }>(tx, 'report_conversation_content', {
        p_conversation_id: parsed.data.conversationId,
        p_message_id: parsed.data.messageId,
        p_category: parsed.data.category,
        p_details: parsed.data.details,
        p_idempotency_key: parsed.data.idempotencyKey,
      }),
    );
    const outcome = OUTCOMES.find((value) => value === data?.outcome);
    if (!outcome) return { ok: false, error: 'INTERNAL' };
    return { ok: true, outcome };
  } catch (error) {
    if (isDatabaseError(error)) return { ok: false, error: mapPgError(databaseErrorMessage(error)) };
    captureError(error, { area: 'messages.reportConversationContent' });
    return { ok: false, error: 'INTERNAL' };
  }
}
