import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { rpc, rpcRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { webPushConfig } from '@/lib/push/config';
import { buildSavedSearchPushMessage } from '@/lib/push/message';
import { sendWebPush, type PushSendOptions } from '@/lib/push/send';

/**
 * Worker kolejki Web Push (#724, 0983) — wołany z `/api/maintenance` po alertach zapisanych
 * wyszukiwań. Bez flagi/kluczy VAPID nie pobiera kolejki (`skipped`). Każda wysyłka:
 * claim (dzierżawa, język odbiorcy) → szyfrowanie i POST do usługi push → `finish_push_delivery`
 * (`sent` / `gone` dla 404/410 → urządzenie unieważnione / `retry` z Retry-After / `failed`).
 * Błąd jednego urządzenia nie zatrzymuje pozostałych ani innych kanałów (e-mail, in-app).
 */

export const PUSH_BATCH_LIMIT = 50;

export type PushQueueRun =
  | { skipped: 'disabled' }
  | { claimed: number; sent: number; gone: number; retried: number; failed: number };

interface ClaimedPush {
  delivery_id: string;
  endpoint: string;
  p256dh: string;
  auth_secret: string;
  locale: string;
  entity_type: string | null;
  job_count: number | null;
}

function isClaimed(row: unknown): row is ClaimedPush {
  const r = row as Record<string, unknown> | null;
  return (
    !!r &&
    typeof r['delivery_id'] === 'string' &&
    typeof r['endpoint'] === 'string' &&
    typeof r['p256dh'] === 'string' &&
    typeof r['auth_secret'] === 'string' &&
    typeof r['locale'] === 'string'
  );
}

async function finish(id: string, outcome: string, code: string | null, retryAfter: number | null): Promise<void> {
  await withServiceRole((tx) =>
    rpc(tx, 'finish_push_delivery', {
      p_delivery_id: id,
      p_outcome: outcome,
      p_error: code,
      p_retry_after_seconds: retryAfter,
    }),
  );
}

export async function processPushQueue(
  options: PushSendOptions & { limit?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<PushQueueRun> {
  const { limit = PUSH_BATCH_LIMIT, env, ...sendOptions } = options;
  const keys = webPushConfig(env);
  if (!keys) return { skipped: 'disabled' };

  const rows = await withServiceRole((tx) => rpcRows(tx, 'claim_push_deliveries', { p_limit: limit }));
  const claimed = rows.filter(isClaimed);
  const run = { claimed: claimed.length, sent: 0, gone: 0, retried: 0, failed: 0 };
  for (const row of claimed) {
    try {
      const message = buildSavedSearchPushMessage(row.locale, row.job_count);
      const payload = new TextEncoder().encode(JSON.stringify(message));
      const outcome = await sendWebPush(
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth_secret },
        payload,
        keys,
        sendOptions,
      );
      if (outcome.kind === 'sent') {
        await finish(row.delivery_id, 'sent', null, null);
        run.sent += 1;
      } else if (outcome.kind === 'gone') {
        await finish(row.delivery_id, 'gone', outcome.code, null);
        run.gone += 1;
      } else if (outcome.kind === 'retry') {
        await finish(row.delivery_id, 'retry', outcome.code, outcome.retryAfterSeconds);
        run.retried += 1;
      } else {
        await finish(row.delivery_id, 'failed', outcome.code, null);
        run.failed += 1;
      }
    } catch (error) {
      captureError(error, { area: 'push.worker' });
      run.failed += 1;
      try {
        await finish(row.delivery_id, 'retry', 'internal', null);
      } catch (finishError) {
        captureError(finishError, { area: 'push.worker.finish' });
      }
    }
  }
  return run;
}
