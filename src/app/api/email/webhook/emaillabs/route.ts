import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { verifyEmailLabsWebhook } from '@/lib/email/emaillabs-webhook';
import { normalizeEmailLabsEvent, type NormalizedEmailEvent } from '@/lib/email/provider-events';
import { isProductionMode } from '@/lib/env';
import { readTextWithLimit } from '@/lib/http/read-limited';
import { captureError } from '@/lib/error-report';

/**
 * Webhook raportów doręczeń EmailLabs — `POST /api/email/webhook/emaillabs`.
 *
 * Kolejność (fail-closed, jak webhook Resend z #44):
 *   1. brak `EMAILLABS_WEBHOOK_SECRET` albo puli service_role → 503 bez czytania treści,
 *   2. suma `X-Webhook-Checksum` (SHA1 sekret|data|Request-Id) i — jeśli skonfigurowany —
 *      Basic auth (`src/lib/email/emaillabs-webhook.ts`) → 401,
 *   3. surowe body z limitem rozmiaru przy streamingu → 413,
 *   4. treść = tablica zdarzeń; każde normalizowane do modelu (`provider-events.ts`),
 *      zdarzenia spoza modelu i uszkodzone są pomijane (EmailLabs zaleca nie odrzucać paczki),
 *   5. inbox `processed_webhooks` `emaillabs:<Request-Id>`: powtórzona paczka (`duplicate`)
 *      albo równoległa dostawa (`locked`) → 200 bez zmian,
 *   6. `record_email_event` (0098) dla każdego zdarzenia w JEDNEJ transakcji: status tylko
 *      „w górę”, trwałe odbicie → blokada adresu. Błąd → 500 (EmailLabs ponowi na drugi URL /
 *      później; zapis jest idempotentny),
 *   7. inbox `completed` → 200 `ok`.
 * EmailLabs czeka na odpowiedź 500 ms — paczka jest zapisywana jedną krótką transakcją.
 * Logi zawierają wyłącznie obszar i liczby — bez adresów, treści i sekretów.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Paczka zdarzeń: do kilkuset małych obiektów; większe body odrzucamy przed weryfikacją. */
const MAX_BODY_BYTES = 1_000_000;
const MAX_EVENTS = 1_000;
const INBOX_SOURCE = 'emaillabs-email-events';

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(body: Record<string, unknown>, status: number): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function ok(): Response {
  return new Response('ok', { status: 200, headers: { ...NO_STORE, 'Content-Type': 'text/plain' } });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.EMAILLABS_WEBHOOK_SECRET?.trim();
  if (!secret || !isServiceDatabaseConfigured()) {
    if (isProductionMode()) {
      captureError(new Error('emaillabs webhook called without configuration'), {
        area: 'email.webhook.emaillabs.config',
      });
    }
    return json({ error: 'not configured' }, 503);
  }

  const h = request.headers;
  const requestId = h.get('request-id')?.trim() ?? null;
  const verified = verifyEmailLabsWebhook(
    {
      secret,
      basicUser: process.env.EMAILLABS_WEBHOOK_BASIC_USER?.trim() || null,
      basicPassword: process.env.EMAILLABS_WEBHOOK_BASIC_PASSWORD || null,
    },
    {
      date: h.get('x-webhook-date'),
      checksum: h.get('x-webhook-checksum'),
      requestId,
      authorization: h.get('authorization'),
    },
  );

  // Suma nie obejmuje treści, więc sprawdzamy ją przed czytaniem body (tańsze odrzucenie).
  if (!verified || !requestId) return json({ error: 'invalid signature' }, 401);
  const bodyRead = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'payload too large' }, 413);

  let payload: unknown;
  try {
    payload = JSON.parse(bodyRead.text);
  } catch {
    return json({ error: 'invalid payload' }, 400);
  }
  const items = Array.isArray(payload) ? payload : [payload];
  if (items.length > MAX_EVENTS) return json({ error: 'payload too large' }, 413);

  const events: NormalizedEmailEvent[] = [];
  for (const item of items) {
    const normalized = normalizeEmailLabsEvent(item);
    if (normalized.status === 'event') events.push(normalized.event);
  }

  const { claimWebhook, completeWebhook } = await import('@/lib/webhook-inbox');
  const inboxId = `emaillabs:${requestId}`;
  const claim = await claimWebhook(inboxId, INBOX_SOURCE);
  if (claim === 'duplicate' || claim === 'locked') return ok();
  if (claim === 'error') {
    captureError(new Error('webhook inbox unavailable'), { area: 'email.webhook.emaillabs.inbox' });
    return json({ error: 'unavailable' }, 503);
  }

  if (events.length > 0) {
    try {
      await withServiceRole(async (tx) => {
        for (const event of events) {
          await rpc(tx, 'record_email_event', {
            p_provider: event.provider,
            p_provider_message_id: event.providerMessageId,
            p_event: event.kind,
            p_occurred_at: event.occurredAt,
            p_recipient: event.recipient,
            p_bounce_type: event.bounceType,
          });
        }
      });
    } catch {
      // Treść błędu bazy może zawierać adres — do kanału błędów idzie tylko liczba zdarzeń.
      captureError(new Error('record_email_event failed'), {
        area: 'email.webhook.emaillabs.record',
        events: events.length,
      });
      return json({ error: 'processing failed' }, 500);
    }
  }

  if (!(await completeWebhook(inboxId))) {
    captureError(new Error('webhook inbox completion failed'), { area: 'email.webhook.emaillabs.complete' });
    return json({ error: 'processing failed' }, 500);
  }
  return ok();
}
