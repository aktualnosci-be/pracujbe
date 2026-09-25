'use server';

import { z } from 'zod/v3';

import { isLocale } from '@/i18n/routing';
import { getOlderThreadMessages, type ThreadCursor } from '@/lib/data/messages';
import { toMessageViews, type ThreadMessageView } from '@/lib/messaging/thread-view';
import { databaseErrorMessage, isDatabaseError } from '@/lib/db/errors';
import { getPortalIdentity, isPortalDataConfigured, withPortalTransaction } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { messageBodySchema } from '@/lib/validation/message';

/**
 * Server Actions komunikacji (Etap 6) — cienka warstwa nad RPC z migracji 0016.
 * Cała logika domenowa (walidacja relacji/uczestnictwa, tworzenie konwersacji z obiema
 * stronami, powiadomienia in-app, kolejka e-mail w języku ODBIORCY) jest w DB (SECURITY
 * DEFINER). Tu: walidacja wejścia + rate limit + mapowanie błędu na kod użytkowy (bez
 * technikaliów — Invariant #8). RPC wołane POD SESJĄ (`withPortalTransaction`, #25) —
 * strona firmowa rozmowy (aktywny członek recruiter+) i uczestnictwo ustala baza.
 *
 * Tryb demo (brak konfiguracji bazy/sesji) zwraca sukces-atrapę, aby UI działało bez backendu.
 */

export type MsgResult = { ok: true; id: string } | { ok: false; error: ErrorCode };
export type OkResult = { ok: true } | { ok: false; error: ErrorCode };

/** Mapuje komunikat błędu z Postgresa/RLS na kod użytkowy (Invariant #8). */
function mapPgError(message: string | undefined): ErrorCode {
  const m = message ?? '';
  if (m.includes('NOT_FOUND')) return 'NOT_FOUND';
  if (m.includes('VALIDATION_FAILED')) return 'VALIDATION_FAILED';
  if (
    m.includes('PERMISSION_DENIED') ||
    m.includes('UNAUTHENTICATED') ||
    m.includes('row-level security')
  ) {
    return 'PERMISSION_DENIED';
  }
  return 'INTERNAL';
}

/** Błąd bazy → kod użytkowy; inny wyjątek (sieć, konfiguracja) → Sentry + INTERNAL. */
function mapFailure(error: unknown, area: string): ErrorCode {
  if (isDatabaseError(error)) return mapPgError(databaseErrorMessage(error));
  captureError(error, { area });
  return 'INTERNAL';
}

/**
 * Otwiera (lub zwraca istniejącą) konwersację powiązaną z aplikacją LUB propozycją.
 * Dokładnie jedno z pól musi być podane — RPC dodatkowo waliduje, że wywołujący jest stroną.
 */
export async function openConversation(input: {
  applicationId?: string;
  offerId?: string;
}): Promise<MsgResult> {
  const applicationId = input.applicationId || undefined;
  const offerId = input.offerId || undefined;

  // XOR: dokładnie jedna relacja.
  if ((applicationId === undefined) === (offerId === undefined)) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isPortalDataConfigured()) return { ok: true, id: 'demo' };

  try {
    // Bez sesji RPC i tak odmawia (UNAUTHENTICATED → PERMISSION_DENIED) — nie pytamy bazy.
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'get_or_create_conversation', {
        p_application_id: applicationId ?? null,
        p_offer_id: offerId ?? null,
      }),
    );
    if (typeof data !== 'string' || !data) return { ok: false, error: 'INTERNAL' };
    return { ok: true, id: data };
  } catch (error) {
    return { ok: false, error: mapFailure(error, 'messages.openConversation') };
  }
}

const clientMessageIdSchema = z.string().uuid();

/**
 * Wysyła wiadomość w konwersacji (tylko uczestnik — egzekwuje RPC).
 * `clientMessageId` = stały UUID jednej operacji wysyłki (#147): ponowienie po utracie
 * odpowiedzi z tym samym kluczem zwraca istniejącą wiadomość bez duplikatu i alertów.
 */
export async function sendMessage(
  conversationId: string,
  body: string,
  clientMessageId: string,
): Promise<MsgResult> {
  const parsed = messageBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  if (!clientMessageIdSchema.safeParse(clientMessageId).success) {
    return { ok: false, error: 'VALIDATION_FAILED' };
  }

  if (!isPortalDataConfigured()) return { ok: true, id: 'demo' };

  // Rate limit per IP (60 wiadomości / godz) — ochrona przed spamowaniem konwersacji.
  if (!(await checkRateLimit('message', { max: 60, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    // Ten sam `client_message_id` przy ponowieniu = ta sama wiadomość (idempotencja w RPC, 0075).
    const data = await withPortalTransaction(me, (tx) =>
      rpc(tx, 'send_message', {
        p_conversation_id: conversationId,
        p_body: parsed.data,
        p_client_message_id: clientMessageId,
      }),
    );
    if (typeof data !== 'string' || !data) return { ok: false, error: 'INTERNAL' };
    return { ok: true, id: data };
  } catch (error) {
    return { ok: false, error: mapFailure(error, 'messages.sendMessage') };
  }
}

/** Oznacza konwersację jako przeczytaną (ustawia `last_read_at`, wygasza powiadomienia). */
export async function markConversationRead(conversationId: string): Promise<OkResult> {
  if (!isPortalDataConfigured()) return { ok: true };

  try {
    const me = await getPortalIdentity();
    if (!me) return { ok: false, error: 'PERMISSION_DENIED' };
    await withPortalTransaction(me, (tx) =>
      rpc(tx, 'mark_conversation_read', { p_conversation_id: conversationId }),
    );
    return { ok: true };
  } catch (error) {
    return { ok: false, error: mapFailure(error, 'messages.markConversationRead') };
  }
}

const olderMessagesInput = z.object({
  locale: z.string().refine(isLocale),
  conversationId: z.string().uuid(),
  cursor: z.object({
    createdAt: z.string().datetime({ offset: true }),
    id: z.string().uuid(),
  }),
});

export type OlderMessagesActionResult =
  | { status: 'ready'; messages: ThreadMessageView[]; olderCursor: ThreadCursor | null }
  | { status: 'not-found' }
  | { status: 'error' };

/**
 * „Wczytaj starsze" w wątku (#146): kolejna strona czytana PONOWNIE pod bieżącą sesją/RLS.
 * Niepoprawne wejście → `error` (UI pokazuje ponowienie, nie „koniec historii").
 */
export async function loadOlderMessages(
  locale: string,
  conversationId: string,
  cursor: unknown,
): Promise<OlderMessagesActionResult> {
  const parsed = olderMessagesInput.safeParse({ locale, conversationId, cursor });
  if (!parsed.success) return { status: 'error' };

  const result = await getOlderThreadMessages(parsed.data.conversationId, parsed.data.cursor);
  if (result.status !== 'ready') return result;
  return {
    status: 'ready',
    messages: toMessageViews(result.messages, parsed.data.locale),
    olderCursor: result.olderCursor,
  };
}
