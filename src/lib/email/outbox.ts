import 'server-only';

import { withServiceRole } from '@/lib/db/portal';
import { execute, queryRows, rpc, rpcRows } from '@/lib/db/sql';
import { renderEmail } from '@/emails/templates';
import { renderNewsletterEmail } from '@/emails/newsletter';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { guestDeliveryToken } from '@/lib/email/guest-delivery';
import { emailPreferenceCategory, emailSendPool } from '@/lib/email/categories';
import {
  createUnsubscribeToken,
  unsubscribeOneClickUrl,
  unsubscribePageUrl,
  unsubscribeSecretFromEnv,
} from '@/lib/email/unsubscribe-token';
import { alertOffPageUrl, createAlertOffToken } from '@/lib/email/saved-search-alert-token';
import { newsletterJobsFromPayload } from '@/lib/email/newsletter-delivery';
import {
  emailFromEnv,
  marketingSenderFromEnv,
  senderIdentityFromEnv,
  type EmailSenderIdentity,
} from '@/lib/email/sender';
import type { EmailType } from '@/emails/copy';
import type { Locale } from '@/i18n/routing';
import { captureError } from '@/lib/sentry';
import { isProductionMode } from '@/lib/env';
import { emailProviderFromEnv, mailTransportFromEnv, MailSendError } from '@/lib/email/transport';

/**
 * Worker kolejki e-mail (outbox) — P1-13.
 *
 * Pobiera zakolejkowane wiadomości (`email_deliveries.status='queued'`, `next_attempt_at<=now`),
 * renderuje szablon React Email W JĘZYKU ODBIORCY (kolumna `locale`, ustawiona w DB wg
 * INVARIANTU #1) i wysyła przez dostawcę z `EMAIL_PROVIDER` (EmailLabs albo Resend —
 * `src/lib/email/transport`). Aktualizuje status/attempts/error/next_attempt_at.
 *
 * Zapis domenowy (aplikacja/propozycja) jest niezależny: błąd dostawcy NIE usuwa rekordu —
 * zwiększa `attempts` i planuje ponowienie (backoff), a po `MAX_ATTEMPTS` oznacza `failed`.
 *
 * Uruchamiany przez chroniony sekretem route handler `/api/email/process` (cron/worker).
 * Claim paczki jest ATOMOWY (RPC `claim_email_batch`, 0021: FOR UPDATE SKIP LOCKED + dzierżawa
 * `locked_at`), więc dwa równoległe workery NIE pobiorą tego samego wiersza — brak podwójnej
 * wysyłki. Wiersz z wygasłą dzierżawą (padły worker) wraca do puli po `p_lease_seconds`.
 *
 * #45 (0087): claim ponownie sprawdza zgodę odbiorcy — wiersz osoby, która się wypisała po
 * zakolejkowaniu, jest w bazie wygaszany i nie dociera do workera. Mail z kategorią preferencji
 * dostaje link wypisania w stopce oraz nagłówki `List-Unsubscribe` + `List-Unsubscribe-Post`
 * (RFC 8058). Przed wysyłką worker pobiera atomowy budżet puli (`take_email_send_budget`);
 * odmowa odkłada wiersz do następnego okna BEZ zwiększania `attempts` (to nie błąd dostawcy).
 *
 * #45, etap 2: każdy mail ma wersję `text/plain` (multipart/alternative). Mail kategorii
 * `marketing` (newsletter z rewizji kampanii, 0101) wychodzi tylko z jawnym `EMAIL_FROM`,
 * tożsamością i adresem pocztowym nadawcy (`EMAIL_SENDER_*`) w stopce oraz działającym
 * wypisaniem — brak którejkolwiek części = błąd wiersza (ponowienie, alarm), nie wysyłka.
 * Tracking otwarć/kliknięć jest wyłączony: nie dodajemy pikseli ani przekierowań, a
 * odebraną wiadomość sprawdza `scripts/check-received-eml.mjs` (docs/RESEND_SETUP.md).
 *
 * #25: baza przez pulę `service` (`withServiceRole`), każda operacja jako OSOBNA, krótka
 * transakcja: claim paczki jest zatwierdzony przed pierwszą wysyłką (dzierżawa widoczna dla
 * innych workerów), a budżet, zapis wyniku i odłożenie wiersza — każde osobno. Żadna
 * transakcja nie jest otwarta podczas wywołania HTTP dostawcy.
 */

const MAX_ATTEMPTS = 5;

// renderEmail jest generyczne po EmailType; na granicy workera dane pochodzą z jsonb (payload),
// więc rzutujemy raz w kontrolowany sposób (bez `any`).
const renderAny = renderEmail as (
  type: EmailType,
  locale: Locale,
  data: Record<string, unknown>,
  options?: { unsubscribeUrl?: string; sender?: EmailSenderIdentity; alertOffUrl?: string },
) => Promise<{ subject: string; html: string; text: string }>;

export interface RenderedDelivery {
  from: string;
  subject: string;
  html: string;
  text: string;
}

/**
 * Treść i nadawca wiersza kolejki (bez I/O dostawcy). Marketing bez kompletnej tożsamości
 * nadawcy albo bez wypisania rzuca błąd — wiersz wraca do ponowienia, nic nie wychodzi.
 */
export async function renderDelivery(
  row: { template: string; payload: Record<string, unknown> | null },
  locale: Locale,
  data: Record<string, unknown>,
  unsubscribeUrl: string | undefined,
  env: Record<string, string | undefined> = process.env,
  /** #100: link „wyłącz tylko ten alert” (digest `jobMatch`), liczony przez workera. */
  alertOffUrl?: string,
): Promise<RenderedDelivery> {
  const isMarketing = emailPreferenceCategory(row.template) === 'marketing';
  if (isMarketing) {
    const marketing = marketingSenderFromEnv(env);
    if (!marketing) throw new Error('marketing email without configured sender identity');
    if (!unsubscribeUrl) throw new Error('marketing email without unsubscribe link');
    const sender = { identity: marketing.identity, postalAddress: marketing.postalAddress };
    if (row.template !== 'newsletter') {
      const rendered = await renderAny(row.template as EmailType, locale, data, { unsubscribeUrl, sender });
      return { from: marketing.from, ...rendered };
    }
    const newsletter = await renderNewsletterEmail(
      locale,
      newsletterJobsFromPayload(row.payload, locale),
      { unsubscribeUrl, sender },
    );
    if (!newsletter.transportReady) throw new Error('newsletter not transport ready');
    return { from: marketing.from, subject: newsletter.subject, html: newsletter.html, text: newsletter.text };
  }
  const rendered = await renderAny(row.template as EmailType, locale, data, {
    unsubscribeUrl,
    sender: senderIdentityFromEnv(env) ?? undefined,
    alertOffUrl,
  });
  return { from: emailFromEnv(env), ...rendered };
}

/** Linki wypisania dla wiersza; `null` = mail bez kategorii preferencji albo bez sekretu. */
export function unsubscribeLinksFor(
  row: { profile_id: string | null; template: string },
  locale: string,
  site: string,
  secret: string | null,
): { pageUrl: string; headers: Record<string, string> } | null {
  const category = emailPreferenceCategory(row.template);
  if (!category || !row.profile_id || !secret) return null;
  const token = createUnsubscribeToken({ profileId: row.profile_id, category }, secret);
  return {
    pageUrl: unsubscribePageUrl(site, locale, token),
    headers: {
      'List-Unsubscribe': `<${unsubscribeOneClickUrl(site, locale, token)}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * #100: link wyłączenia JEDNEGO alertu dla digestu `jobMatch` zapisanego wyszukiwania.
 * `null` = inny typ maila, brak powiązanego wyszukiwania albo brak sekretu. Token niesie
 * tylko UUID konta i wyszukiwania (bez e-maila); zapis dopiero po kliknięciu na stronie.
 */
export function alertOffLinkFor(
  row: { profile_id: string | null; template: string; entity_type?: string | null; entity_id?: string | null },
  locale: string,
  site: string,
  secret: string | null,
): string | null {
  if (row.template !== 'jobMatch' || row.entity_type !== 'saved_search') return null;
  if (!row.profile_id || !row.entity_id || !UUID_RE.test(row.entity_id) || !secret) return null;
  const token = createAlertOffToken({ profileId: row.profile_id, savedSearchId: row.entity_id }, secret);
  return alertOffPageUrl(site, locale, token);
}

interface DeliveryRow {
  id: string;
  profile_id: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
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
  /** Wiersze odłożone do następnego okna budżetu (bez zwiększania `attempts`). */
  deferred?: number;
  skipped?: string;
  /** Wiersze wygaszone tuż przed wysyłką (wypisanie/blokada po claimie, #466 pkt 8). */
  suppressed?: number;
  /**
   * P1-17: sygnał zdrowia dla endpointu (200 vs 503). `false` = realny problem
   * (brak konfiguracji w produkcji, błąd claimu) — monitoring NIE może widzieć „zielonego"
   * cronu, gdy nic nie wychodzi. `true` = przetworzono (także pustą kolejkę) albo oczekiwane
   * pominięcie w trybie demo.
   */
  ok: boolean;
}

export async function processEmailQueue(limit = 20): Promise<ProcessResult> {
  const transport = mailTransportFromEnv();
  const site = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  if (!transport) {
    // Brak dostawcy w PRODUKCJI = błąd konfiguracji (503, alarm). W demo = oczekiwane (200).
    const { provider } = emailProviderFromEnv();
    return {
      processed: 0,
      sent: 0,
      failed: 0,
      skipped: provider ? `${provider} not configured` : 'email provider not configured',
      ok: !isProductionMode(),
    };
  }

  // Atomowy claim (RPC 0021: FOR UPDATE SKIP LOCKED + dzierżawa locked_at) — dwa równoległe
  // workery NIE pobiorą tego samego wiersza, więc brak podwójnej wysyłki (P2#6). Własna
  // transakcja: dzierżawa jest zatwierdzona, zanim zaczniemy wysyłać.
  let queue: DeliveryRow[];
  try {
    queue = await withServiceRole((tx) =>
      rpcRows<DeliveryRow>(tx, 'claim_email_batch', { p_limit: limit }),
    );
  } catch (error) {
    captureError(error, { area: 'email.outbox.claim' });
    return { processed: 0, sent: 0, failed: 0, skipped: 'claim error', ok: false };
  }

  const unsubscribeSecret = unsubscribeSecretFromEnv();
  let sent = 0;
  let failed = 0;
  let deferred = 0;
  let suppressed = 0;
  // Pula, która w tej paczce dostała odmowę, czeka do podanego okna (bez kolejnych zapytań).
  const exhausted = new Map<string, string>();

  /** Zwalnia dzierżawę i odkłada wiersz; `attempts` bez zmian — outbox pozostaje ponawialny. */
  async function defer(rowId: string, nextAttemptAt: string): Promise<void> {
    try {
      await withServiceRole((tx) =>
        execute(
          tx,
          'email.outbox.defer',
          'UPDATE public.email_deliveries SET locked_at = NULL, next_attempt_at = $2 WHERE id = $1',
          [rowId, nextAttemptAt],
        ),
      );
    } catch (deferErr) {
      captureError(deferErr, { area: 'email.outbox.defer', deliveryId: rowId });
    }
    deferred += 1;
  }

  // #294: imię ODBIORCY do powitania — jeden odczyt na paczkę. Best-effort: błąd odczytu nie
  // blokuje wysyłki (mail wychodzi z neutralnym powitaniem).
  const firstNames = new Map<string, string>();
  const profileIds = [...new Set(queue.map((r) => r.profile_id).filter((v): v is string => !!v))];
  if (profileIds.length > 0) {
    try {
      const profiles = await withServiceRole((tx) =>
        queryRows<{ id: string; first_name: string | null }>(
          tx,
          'email.outbox.recipient-names',
          'SELECT id, first_name FROM public.profiles WHERE id = ANY($1::uuid[])',
          [profileIds],
        ),
      );
      for (const p of profiles) {
        if (p.first_name) firstNames.set(p.id, p.first_name);
      }
    } catch (profilesErr) {
      captureError(profilesErr, { area: 'email.outbox.recipientNames' });
    }
  }

  for (const row of queue) {
    const pool = emailSendPool(row.template);
    const waitUntil = exhausted.get(pool);
    if (waitUntil) {
      await defer(row.id, waitUntil);
      continue;
    }

    try {
      // #290: CTA do właściwej sekcji panelu, w locale odbiorcy (kolumna `locale`).
      // #98: e-mail do gościa dostaje link z tokenem liczonym tutaj (w bazie tylko hash);
      // brak tokenu = błąd tego wiersza (ponowienie), nie przerwanie paczki.
      const { locale, data } = buildDeliveryData(
        row,
        site,
        row.profile_id ? firstNames.get(row.profile_id) : undefined,
        guestDeliveryToken(row.template, row.payload),
      );
      const unsubscribe = unsubscribeLinksFor(row, locale, site, unsubscribeSecret);
      if (!unsubscribe && pool === 'marketing') {
        // Marketing nigdy nie wychodzi bez działającego wypisania (#45).
        throw new Error('marketing email without unsubscribe link');
      }
      const { from, subject, html, text } = await renderDelivery(
        row,
        locale,
        data,
        unsubscribe?.pageUrl,
        process.env,
        alertOffLinkFor(row, locale, site, unsubscribeSecret) ?? undefined,
      );

      // #100 / #466 pkt 8: ponowna kontrola zgody tuż przed wysyłką (kategoria, blokada
      // adresu, uprawnienie odbiorcy firmowego z 0122, wyłączony alert, kampania). Odbiorca mógł się wypisać po claimie — wtedy
      // baza wygasza wiersz (ślad zostaje), a my nic nie wysyłamy i nie zużywamy budżetu.
      const blockedReason = await withServiceRole((tx) =>
        rpc<string | null>(tx, 'email_delivery_send_check', { p_delivery_id: row.id }),
      );
      if (blockedReason !== null) {
        suppressed += 1;
        continue;
      }

      // #45: atomowy budżet puli tuż przed wysyłką (równoległe workery nie przekroczą limitu).
      const [grant] = await withServiceRole((tx) =>
        rpcRows<{ granted?: boolean; retry_at?: string | null }>(tx, 'take_email_send_budget', {
          p_template: row.template,
        }),
      );
      if (grant?.granted !== true) {
        const retryAt = grant?.retry_at ?? new Date(Date.now() + 60_000).toISOString();
        exhausted.set(pool, retryAt);
        await defer(row.id, retryAt);
        continue;
      }

      // P1-17: klucz idempotencji = delivery.id — jeśli po wysyłce zapis 'sent' zawiedzie i
      // wiersz wróci do puli, ponowienie nie tworzy drugiego listu (Resend: Idempotency-Key,
      // EmailLabs: stały messageId + sprawdzenie przed wysyłką). Transport potwierdza wysyłkę
      // tylko z identyfikatorem wiadomości od dostawcy.
      const result = await transport.send(
        {
          from,
          to: row.to_email,
          subject,
          html,
          text,
          ...(unsubscribe ? { headers: unsubscribe.headers } : {}),
        },
        { idempotencyKey: row.id },
      );

      const providerMessageId = result.id;
      // Zapis wyniku PO wysyłce — osobna transakcja (bez otwartej transakcji w trakcie HTTP).
      // SEC-15: e-mail WYSŁANY, ale zapis „sent" się nie powiódł — stan niejednoznaczny.
      // Bez tego rekord wróciłby do 'queued' (po wygaśnięciu dzierżawy) i został wysłany PONOWNIE
      // (duplikat). Nie da się tu bezpiecznie ponowić; logujemy z provider_message_id do
      // ręcznej reconciliacji (i liczymy jako wysłany, by nie zawyżać 'failed').
      try {
        await withServiceRole((tx) =>
          execute(
            tx,
            'email.outbox.mark-sent',
            `UPDATE public.email_deliveries
                SET status = 'sent', sent_at = now(), provider = $4,
                    provider_message_id = $2, attempts = $3, locked_at = NULL
              WHERE id = $1`,
            [row.id, providerMessageId, row.attempts + 1, transport.provider],
          ),
        );
      } catch (markErr) {
        captureError(markErr, {
          area: 'email.outbox.markSent',
          deliveryId: row.id,
          providerMessageId,
        });
      }
      sent += 1;
    } catch (err) {
      const attempts = row.attempts + 1;
      const isFinal = attempts >= MAX_ATTEMPTS;
      const backoffMin = Math.min(2 ** attempts, 60);
      // SEC-15: sprawdzamy też błąd zapisu stanu porażki (inaczej rekord utknąłby zablokowany).
      try {
        await withServiceRole((tx) =>
          execute(
            tx,
            'email.outbox.mark-failed',
            `UPDATE public.email_deliveries
                SET status = $2, attempts = $3, error_message = $4, next_attempt_at = $5, locked_at = NULL
              WHERE id = $1`,
            [
              row.id,
              isFinal ? 'failed' : 'queued',
              attempts,
              // Kod błędu dostawcy zamiast jego komunikatu (może zawierać adres odbiorcy).
              err instanceof MailSendError ? err.message : err instanceof Error ? err.message.slice(0, 500) : 'unknown',
              new Date(Date.now() + backoffMin * 60_000).toISOString(),
            ],
          ),
        );
      } catch (failErr) {
        captureError(failErr, { area: 'email.outbox.markFailed', deliveryId: row.id });
      }
      captureError(err, { area: 'email.outbox.send', deliveryId: row.id });
      failed += 1;
    }
  }

  return { processed: queue.length, sent, failed, deferred, suppressed, ok: true };
}
