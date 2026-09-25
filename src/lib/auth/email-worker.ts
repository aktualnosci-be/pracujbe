import 'server-only';

import { Resend } from 'resend';

import { renderEmail } from '@/emails/templates';
import { emailFromEnv } from '@/lib/email/sender';
import { env, isAuthMailConfigured, isPortalAuthConfigured, isProductionMode } from '@/lib/env';
import { captureError } from '@/lib/sentry';
import {
  claimAuthEmails,
  completeAuthEmail,
  expireAuthEmails,
  failAuthEmail,
  prepareAuthEmail,
  type AuthEmailDelivery,
} from './email-outbox';

export interface AuthEmailProcessResult {
  processed: number;
  sent: number;
  failed: number;
  expired: number;
  skipped?: string;
  /** `false` = realny problem (brak konfiguracji w produkcji, błąd claimu) → 503 dla cronu. */
  ok: boolean;
}

type MailPool = Parameters<typeof claimAuthEmails>[0];

interface MailSender {
  send(
    message: { from: string; to: string; subject: string; html: string; text: string },
    options: { idempotencyKey: string },
  ): Promise<{ id: string }>;
}

function resendSender(apiKey: string): MailSender {
  const resend = new Resend(apiKey);
  return {
    async send(message, options) {
      const result = await resend.emails.send(message, options);
      // Komunikat dostawcy może zawierać adres odbiorcy — nie przenosimy go dalej.
      if (result.error || !result.data?.id) throw new Error('AUTH_EMAIL_PROVIDER_REJECTED');
      return { id: result.data.id };
    },
  };
}

/**
 * Jedna paczka kolejki `auth.email_outbox` (0061): potwierdzenie adresu i reset hasła.
 * Pula ma wyłącznie rolę `pracujbe_auth_mail` (claim/complete/fail/expire), bez tabel domeny.
 * Klucz idempotencji Resend = UUID zlecenia, więc ponowienie po utraconej odpowiedzi nie wysyła
 * drugiego listu. Token nigdy nie trafia do logów ani Sentry; po wysyłce baza go usuwa.
 */
export async function processAuthEmailBatch(
  pool: MailPool,
  sender: MailSender,
  options: { baseURL: string; from: string; limit?: number },
): Promise<AuthEmailProcessResult> {
  let expired = 0;
  let queue: AuthEmailDelivery[];
  try {
    expired = await expireAuthEmails(pool);
    queue = await claimAuthEmails(pool, options.limit ?? 20);
  } catch (error) {
    captureError(error, { area: 'auth.email.claim' });
    return { processed: 0, sent: 0, failed: 0, expired, skipped: 'claim error', ok: false };
  }

  let sent = 0;
  let failed = 0;
  for (const delivery of queue) {
    let message: { subject: string; html: string; text: string };
    let prepared: ReturnType<typeof prepareAuthEmail>;
    try {
      prepared = prepareAuthEmail(delivery, options.baseURL);
      message = await renderEmail(prepared.template, prepared.locale, prepared.data);
    } catch (error) {
      captureError(error, { area: 'auth.email.render', kind: delivery.kind });
      await failAuthEmail(pool, delivery, 'render_failed').catch(() => false);
      failed += 1;
      continue;
    }
    try {
      const result = await sender.send(
        { from: options.from, to: prepared.to, ...message },
        { idempotencyKey: prepared.idempotencyKey },
      );
      await completeAuthEmail(pool, delivery, result.id);
      sent += 1;
    } catch (error) {
      captureError(error, { area: 'auth.email.send', kind: delivery.kind });
      // Dzierżawa wygaśnie sama, gdy zapis porażki też się nie uda — zlecenie wróci do kolejki.
      await failAuthEmail(pool, delivery, 'delivery_failed').catch(() => false);
      failed += 1;
    }
  }
  return { processed: queue.length, sent, failed, expired, ok: true };
}

/**
 * Wywołanie z `/api/email/process` (cron Railway). Bez kont PostgreSQL (tryb demo / przed
 * przepięciem) kolejka nie istnieje → pominięcie bez alarmu. Konta skonfigurowane, a brak loginu
 * workera, klucza Resend lub kanonicznego origin w produkcji → `ok: false` (listy nie wychodzą).
 */
export async function processAuthEmailQueue(limit = 20): Promise<AuthEmailProcessResult> {
  const empty = { processed: 0, sent: 0, failed: 0, expired: 0 };
  if (!isPortalAuthConfigured()) return { ...empty, skipped: 'auth not configured', ok: true };
  const apiKey = process.env.RESEND_API_KEY;
  const baseURL = env.authBaseUrl;
  if (!isAuthMailConfigured() || !apiKey || !baseURL) {
    return { ...empty, skipped: 'auth mail not configured', ok: !isProductionMode() };
  }
  try {
    const { getAuthMailPool } = await import('@/lib/db/runtime');
    return await processAuthEmailBatch(await getAuthMailPool(), resendSender(apiKey), {
      baseURL,
      from: emailFromEnv(),
      limit,
    });
  } catch (error) {
    captureError(error, { area: 'auth.email.worker' });
    return { ...empty, skipped: 'worker error', ok: false };
  }
}
