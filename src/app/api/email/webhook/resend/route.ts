import { isServiceDatabaseConfigured, withServiceRole } from '@/lib/db/portal';
import { rpc } from '@/lib/db/sql';
import { normalizeResendEvent } from '@/lib/email/provider-events';
import { isProductionMode } from '@/lib/env';
import { readTextWithLimit } from '@/lib/http/read-limited';
import { captureError } from '@/lib/sentry';
import { verifyStandardWebhook } from '@/lib/webhooks';

/**
 * Webhook zdarzeń doręczeń Resend (#44) — `POST /api/email/webhook/resend`.
 *
 * Kolejność (fail-closed):
 *   1. brak `RESEND_WEBHOOK_SECRET` albo puli service_role (`DATABASE_SERVICE_URL`) → 503
 *      bez czytania treści
 *      (dostawca ponowi dostawę; nigdy nie przyjmujemy zdarzeń bez weryfikacji podpisu),
 *   2. surowe body z limitem rozmiaru przy streamingu → 413,
 *   3. podpis Svix/Standard Webhooks (HMAC-SHA256, stałoczasowo) + świeżość znacznika czasu
 *      (±300 s, anty-replay) → 401,
 *   4. normalizacja do modelu zdarzeń (`provider-events.ts`); zdarzenie spoza modelu → 200,
 *   5. inbox `processed_webhooks` (claim z dzierżawą): powtórzone zakończone zdarzenie
 *      (`duplicate`) albo równoległa dostawa (`locked`) → 200 bez zmian,
 *   6. RPC `record_email_event` (0098): status tylko „w górę”, trwałe odbicie i skarga →
 *      blokada adresu. Błąd → 500 (dostawca ponowi; zapis jest idempotentny),
 *   7. inbox `completed` → 200.
 * #25: claim, zapis zdarzenia i complete to trzy osobne, krótkie transakcje service_role —
 * dzierżawa jest widoczna dla równoległych dostaw od chwili claimu.
 *
 * Logi zawierają wyłącznie obszar i rodzaj zdarzenia — bez adresu, treści i sekretów.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const TIMESTAMP_TOLERANCE_SECONDS = 300;
/** Zdarzenia Resend są małe; większe body odrzucamy przed weryfikacją podpisu. */
const MAX_BODY_BYTES = 256_000;
const INBOX_SOURCE = 'resend-email-events';

const NO_STORE = { 'Cache-Control': 'no-store' };

function json(body: Record<string, unknown>, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET?.trim();
  if (!secret || !isServiceDatabaseConfigured()) {
    if (isProductionMode()) {
      captureError(new Error('resend webhook called without configuration'), {
        area: 'email.webhook.config',
      });
    }
    return json({ error: 'not configured' }, 503);
  }

  const bodyRead = await readTextWithLimit(request, MAX_BODY_BYTES);
  if (!bodyRead.ok) return json({ error: 'payload too large' }, 413);
  const rawBody = bodyRead.text;

  // Resend podpisuje przez Svix (nagłówki `svix-*`); ten sam format co Standard Webhooks.
  const h = request.headers;
  const eventId = h.get('svix-id') ?? h.get('webhook-id');
  const verified = verifyStandardWebhook(
    secret,
    {
      id: eventId,
      timestamp: h.get('svix-timestamp') ?? h.get('webhook-timestamp'),
      signature: h.get('svix-signature') ?? h.get('webhook-signature'),
    },
    rawBody,
    { toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS },
  );
  if (!verified || !eventId) return json({ error: 'invalid signature' }, 401);

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid payload' }, 400);
  }
  const normalized = normalizeResendEvent(payload);
  if (normalized.status === 'invalid') return json({ error: 'invalid payload' }, 400);
  if (normalized.status === 'ignored') return json({ ok: true, ignored: true });
  const { event } = normalized;

  const { claimWebhook, completeWebhook } = await import('@/lib/webhook-inbox');
  const inboxId = `resend:${eventId}`;
  const claim = await claimWebhook(inboxId, INBOX_SOURCE);
  if (claim === 'duplicate') return json({ ok: true, duplicate: true });
  if (claim === 'locked') return json({ ok: true, locked: true });
  if (claim === 'error') {
    captureError(new Error('webhook inbox unavailable'), { area: 'email.webhook.inbox' });
    return json({ error: 'unavailable' }, 503);
  }

  try {
    await withServiceRole((tx) =>
      rpc(tx, 'record_email_event', {
        p_provider: event.provider,
        p_provider_message_id: event.providerMessageId,
        p_event: event.kind,
        p_occurred_at: event.occurredAt,
        p_recipient: event.recipient,
        p_bounce_type: event.bounceType,
      }),
    );
  } catch {
    // Treść błędu bazy może zawierać adres — do Sentry idzie tylko rodzaj zdarzenia.
    captureError(new Error('record_email_event failed'), {
      area: 'email.webhook.record',
      kind: event.kind,
    });
    return json({ error: 'processing failed' }, 500);
  }

  if (!(await completeWebhook(inboxId))) {
    captureError(new Error('webhook inbox completion failed'), { area: 'email.webhook.complete' });
    return json({ error: 'processing failed' }, 500);
  }
  return json({ ok: true });
}
