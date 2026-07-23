import 'server-only';

import { Resend } from 'resend';

import { createAdminClient } from '@/lib/supabase/admin';
import { renderEmail } from '@/emails/templates';
import type { EmailType } from '@/emails/copy';
import type { Locale } from '@/i18n/routing';
import { captureError } from '@/lib/sentry';

/**
 * Worker kolejki e-mail (outbox) — P1-13.
 *
 * Pobiera zakolejkowane wiadomości (`email_deliveries.status='queued'`, `next_attempt_at<=now`),
 * renderuje szablon React Email W JĘZYKU ODBIORCY (kolumna `locale`, ustawiona w DB wg
 * INVARIANTU #1) i wysyła przez Resend. Aktualizuje status/attempts/error/next_attempt_at.
 *
 * Zapis domenowy (aplikacja/propozycja) jest niezależny: błąd dostawcy NIE usuwa rekordu —
 * zwiększa `attempts` i planuje ponowienie (backoff), a po `MAX_ATTEMPTS` oznacza `failed`.
 *
 * Uruchamiany przez chroniony sekretem route handler `/api/email/process` (cron/worker).
 * Zakłada pojedynczego workera na tick (brak równoległych claimów) — przy skalowaniu dodać
 * atomowy claim (SELECT ... FOR UPDATE SKIP LOCKED przez RPC).
 */

const MAX_ATTEMPTS = 5;

// renderEmail jest generyczne po EmailType; na granicy workera dane pochodzą z jsonb (payload),
// więc rzutujemy raz w kontrolowany sposób (bez `any`).
const renderAny = renderEmail as (
  type: EmailType,
  locale: Locale,
  data: Record<string, unknown>,
) => Promise<{ subject: string; html: string }>;

interface DeliveryRow {
  id: string;
  to_email: string;
  template: string;
  locale: string;
  payload: Record<string, unknown> | null;
  attempts: number;
}

export interface ProcessResult {
  processed: number;
  sent: number;
  failed: number;
  skipped?: string;
}

export async function processEmailQueue(limit = 20): Promise<ProcessResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM ?? 'Pracuj.be <no-reply@pracuj.be>';
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  if (!apiKey) {
    return { processed: 0, sent: 0, failed: 0, skipped: 'RESEND_API_KEY not set' };
  }

  const admin = createAdminClient();
  const nowIso = new Date().toISOString();

  const { data: rows, error } = await admin
    .from('email_deliveries')
    .select('id, to_email, template, locale, payload, attempts')
    .eq('status', 'queued')
    .lte('next_attempt_at', nowIso)
    .order('queued_at', { ascending: true })
    .limit(limit);

  if (error) {
    captureError(error, { area: 'email.outbox.fetch' });
    return { processed: 0, sent: 0, failed: 0, skipped: 'fetch error' };
  }

  const queue = (rows ?? []) as DeliveryRow[];
  const resend = new Resend(apiKey);
  let sent = 0;
  let failed = 0;

  for (const row of queue) {
    const base = `${site}/${row.locale}`;
    // Panel odbiorcy wiadomości ('employer'|'candidate') przenoszony w payloadzie z RPC send_message.
    const panel = (row.payload?.['panel'] === 'employer' ? 'employer' : 'candidate');
    const data: Record<string, unknown> = {
      ...(row.payload ?? {}),
      applicationUrl: row.template === 'newApplication' ? `${base}/employer` : `${base}/candidate`,
      offerUrl: `${base}/candidate`,
      actionUrl: `${base}/employer`,
      messageUrl: `${base}/${panel}/wiadomosci`,
    };

    try {
      const { subject, html } = await renderAny(
        row.template as EmailType,
        row.locale as Locale,
        data,
      );
      const result = await resend.emails.send({ from, to: row.to_email, subject, html });

      if (result.error) {
        throw new Error(result.error.message);
      }

      await admin
        .from('email_deliveries')
        .update({
          status: 'sent',
          sent_at: new Date().toISOString(),
          provider: 'resend',
          provider_message_id: result.data?.id ?? null,
          attempts: row.attempts + 1,
          locked_at: null,
        })
        .eq('id', row.id);
      sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const isFinal = attempts >= MAX_ATTEMPTS;
      const backoffMin = Math.min(2 ** attempts, 60);
      await admin
        .from('email_deliveries')
        .update({
          status: isFinal ? 'failed' : 'queued',
          attempts,
          error_message: err instanceof Error ? err.message.slice(0, 500) : 'unknown',
          next_attempt_at: new Date(Date.now() + backoffMin * 60_000).toISOString(),
          locked_at: null,
        })
        .eq('id', row.id);
      captureError(err, { area: 'email.outbox.send', deliveryId: row.id });
      failed += 1;
    }
  }

  return { processed: queue.length, sent, failed };
}
