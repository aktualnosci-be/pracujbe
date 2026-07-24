import type Stripe from 'stripe';

import { getStripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureError } from '@/lib/sentry';
import { isProductionMode } from '@/lib/env';
import { claimWebhook, completeWebhook } from '@/lib/webhook-inbox';

/**
 * Webhook Stripe — ŹRÓDŁO PRAWDY o stanie subskrypcji/faktur/płatności (FUN-08).
 *
 * Weryfikuje podpis (`stripe.webhooks.constructEvent`, surowe body) i synchronizuje stan do DB
 * service-rolem (klient nigdy nie pisze subscriptions/invoices/payments). Bez konfiguracji
 * (brak `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`) → 200 no-op (nie powinien być wołany).
 * Nie ujawnia technikaliów (Invariant #8).
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Limit rozmiaru body (SEC-14): zdarzenia Stripe są małe; odrzucamy oversize przed alokacją. */
const MAX_BODY_BYTES = 1_000_000;

type Admin = ReturnType<typeof createAdminClient>;

function toIso(unix: number | null | undefined): string | null {
  return typeof unix === 'number' && unix > 0 ? new Date(unix * 1000).toISOString() : null;
}

/** Mapuje status subskrypcji Stripe → enum `subscription_status`. */
function mapSubStatus(s: string): string {
  switch (s) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'paused':
      return 'canceled';
    case 'incomplete_expired':
      return 'expired';
    default:
      return 'incomplete';
  }
}

function customerId(sub: Stripe.Subscription): string | null {
  return typeof sub.customer === 'string' ? sub.customer : (sub.customer?.id ?? null);
}

/** Rzuca, gdy Supabase zwrócił błąd zapisu (P0-03: żaden błąd DB nie może być cicho zignorowany). */
function assertNoDbError(error: unknown, op: string): void {
  if (error) {
    const msg = (error as { message?: string }).message ?? 'db error';
    throw new Error(`DB ${op}: ${msg}`);
  }
}

/**
 * Upsert subskrypcji po provider_subscription_id (insert/update). P0-03: każdy błąd zapisu
 * jest sprawdzany i propagowany (rzut → 500 → Stripe ponawia → inbox pozwala reprocesować).
 */
async function upsertSubscription(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  const company = sub.metadata?.['company_id'];
  if (!company) return; // brak mapowania firmy → nic nie zapisujemy (reconciliation osobno)

  const item = sub.items?.data?.[0];
  const periodStart = (sub as unknown as { current_period_start?: number }).current_period_start;
  const periodEnd = (sub as unknown as { current_period_end?: number }).current_period_end;

  const row: Record<string, unknown> = {
    company_id: company,
    plan: sub.metadata?.['plan'] ?? 'standard',
    status: mapSubStatus(sub.status),
    provider: 'stripe',
    provider_customer_id: customerId(sub),
    provider_subscription_id: sub.id,
    quantity: item?.quantity ?? 1,
    current_period_start: toIso(periodStart),
    current_period_end: toIso(periodEnd),
    cancel_at: toIso(sub.cancel_at),
    canceled_at: toIso(sub.canceled_at),
    trial_ends_at: toIso(sub.trial_end),
    updated_at: new Date().toISOString(),
  };

  const { data, error: selErr } = await admin
    .from('subscriptions')
    .select('id')
    .eq('provider_subscription_id', sub.id)
    .limit(1);
  assertNoDbError(selErr, 'subscriptions.select');
  const existingId = Array.isArray(data) && data[0] ? (data[0] as { id?: string }).id : undefined;
  if (existingId) {
    const { error } = await admin.from('subscriptions').update(row).eq('id', existingId);
    assertNoDbError(error, 'subscriptions.update');
  } else {
    // Wyścig select-then-insert (P0-03): unikat provider_subscription_id (0007) chroni bazę;
    // przy 23505 (współbieżny insert) traktujemy jako update po kluczu, nie jako błąd.
    const { error } = await admin.from('subscriptions').insert(row);
    if (error && (error as { code?: string }).code === '23505') {
      const { error: updErr } = await admin
        .from('subscriptions')
        .update(row)
        .eq('provider_subscription_id', sub.id);
      assertNoDbError(updErr, 'subscriptions.update(after-conflict)');
    } else {
      assertNoDbError(error, 'subscriptions.insert');
    }
  }
}

/**
 * Zapisuje fakturę + płatność po opłaceniu/niepowodzeniu faktury. P0-03: błędy zapisu są
 * sprawdzane i propagowane; płatność sukcesu jest IDEMPOTENTNA per faktura (koniec podwójnych
 * płatności z równoległych zdarzeń `invoice.paid` + `invoice.payment_succeeded`).
 */
async function recordInvoice(admin: Admin, invoice: Stripe.Invoice, paid: boolean): Promise<void> {
  if (!invoice.number) return; // rejestrujemy tylko sfinalizowane faktury (unikat number)
  const stripeSubId =
    typeof (invoice as unknown as { subscription?: unknown }).subscription === 'string'
      ? ((invoice as unknown as { subscription?: string }).subscription as string)
      : null;

  let companyId: string | null = null;
  let ourSubId: string | null = null;
  if (stripeSubId) {
    const { data, error } = await admin
      .from('subscriptions')
      .select('id, company_id')
      .eq('provider_subscription_id', stripeSubId)
      .limit(1);
    assertNoDbError(error, 'subscriptions.select(for-invoice)');
    const r = Array.isArray(data) && data[0] ? (data[0] as { id?: string; company_id?: string }) : null;
    if (r) {
      ourSubId = r.id ?? null;
      companyId = r.company_id ?? null;
    }
  }
  if (!companyId) return; // brak mapowania → reconciliation osobno (nie zapisujemy „w powietrze")

  const currency = (invoice.currency ?? 'eur').toUpperCase();
  const invoiceRow: Record<string, unknown> = {
    company_id: companyId,
    subscription_id: ourSubId,
    number: invoice.number,
    status: paid ? 'paid' : 'open',
    amount_cents: paid ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0),
    currency,
    issued_at: toIso(invoice.created),
    paid_at: paid ? toIso(invoice.status_transitions?.paid_at) : null,
    updated_at: new Date().toISOString(),
  };
  const { data: invData, error: invSelErr } = await admin
    .from('invoices')
    .select('id')
    .eq('number', invoice.number)
    .limit(1);
  assertNoDbError(invSelErr, 'invoices.select');
  const invId = Array.isArray(invData) && invData[0] ? (invData[0] as { id?: string }).id : undefined;
  let invoiceUuid = invId;
  if (invId) {
    const { error } = await admin.from('invoices').update(invoiceRow).eq('id', invId);
    assertNoDbError(error, 'invoices.update');
  } else {
    const { data: ins, error } = await admin.from('invoices').insert(invoiceRow).select('id').limit(1);
    assertNoDbError(error, 'invoices.insert');
    invoiceUuid = Array.isArray(ins) && ins[0] ? (ins[0] as { id?: string }).id : undefined;
  }

  const pi = (invoice as unknown as { payment_intent?: unknown }).payment_intent;
  const providerPaymentId = typeof pi === 'string' ? pi : null;

  // Idempotencja płatności (P0-03): dla opłaconej faktury zapisujemy DOKŁADNIE jedną płatność
  // sukcesu — bez tego `invoice.paid` i `invoice.payment_succeeded` tworzyłyby dublet.
  if (paid && invoiceUuid) {
    const { data: existing, error: paySelErr } = await admin
      .from('payments')
      .select('id')
      .eq('invoice_id', invoiceUuid)
      .eq('status', 'succeeded')
      .limit(1);
    assertNoDbError(paySelErr, 'payments.select');
    if (Array.isArray(existing) && existing[0]) return; // płatność sukcesu już zapisana
  }

  const { error: payErr } = await admin.from('payments').insert({
    company_id: companyId,
    subscription_id: ourSubId,
    invoice_id: invoiceUuid ?? null,
    status: paid ? 'succeeded' : 'failed',
    amount_cents: paid ? (invoice.amount_paid ?? 0) : (invoice.amount_due ?? 0),
    currency,
    provider: 'stripe',
    provider_payment_id: providerPaymentId,
    paid_at: paid ? toIso(invoice.status_transitions?.paid_at) : null,
  });
  // Unikat provider_payment_id (0007) — współbieżny dublet po tym samym payment_intent → nie błąd.
  if (payErr && (payErr as { code?: string }).code !== '23505') {
    assertNoDbError(payErr, 'payments.insert');
  }
}

export async function POST(request: Request): Promise<Response> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // P0-04: brak konfiguracji. W PRODUKCJI to błąd krytyczny — 503 + alarm (nie „cichy" 200,
  // który kazałby Stripe uznać zdarzenie za dostarczone i porzucić płatność bez śladu).
  // W trybie demo (lokalnie/staging/E2E) webhook nie powinien być wołany → 200 no-op.
  if (!stripe || !secret) {
    if (isProductionMode()) {
      captureError(new Error('stripe webhook called without configuration'), { area: 'stripe.webhook' });
      return Response.json({ error: 'not configured' }, { status: 503 });
    }
    return Response.json({ ok: true, skipped: true });
  }

  const sig = request.headers.get('stripe-signature');
  if (!sig) return Response.json({ error: 'missing signature' }, { status: 400 });

  // SEC-14: odrzuć oversize body przed alokacją (ochrona pamięci/CPU).
  const contentLength = Number(request.headers.get('content-length') ?? '0');
  if (Number.isFinite(contentLength) && contentLength > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload too large' }, { status: 413 });
  }

  const rawBody = await request.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, secret);
  } catch {
    return Response.json({ error: 'invalid signature' }, { status: 400 });
  }

  const inboxId = `stripe:${event.id}`;
  try {
    const admin = createAdminClient();

    // P0-01 + SEC-14: inbox ze stanem. Duplikatem (do pominięcia) jest WYŁĄCZNIE zdarzenie już
    // `completed`. Claim wstawia `processing`; oznaczamy `completed` dopiero po sukcesie — awaria
    // w trakcie NIE blokuje ponowienia (zapisy poniżej są idempotentne po stabilnych ID Stripe).
    const claim = await claimWebhook(admin, inboxId, 'stripe');
    if (claim === 'duplicate') return Response.json({ received: true, duplicate: true });
    if (claim === 'error') {
      // Inbox nieosiągalny — przetwarzamy mimo to (idempotentnie), by nie zgubić zdarzenia.
      captureError(new Error('webhook inbox unreachable'), { area: 'stripe.webhook.claim', type: event.type });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId = typeof session.subscription === 'string' ? session.subscription : null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscription(admin, sub);
        }
        // P1-15: finalizacja rezerwacji kodu rabatowego (reserved → finalized + licznik).
        const codeId = session.metadata?.['discount_code_id'];
        const companyId = session.metadata?.['company_id'];
        if (codeId && companyId) {
          const { error: finErr } = await admin.rpc('finalize_discount', {
            p_code_id: codeId,
            p_company_id: companyId,
            p_session_id: session.id,
          });
          // P1-22: błąd finalizacji rabatu NIE może być cicho połknięty — inaczej rezerwacja
          // utknie w 'reserved' (limit zablokowany na stałe), a licznik times_redeemed nie
          // wzrośnie. Rzut → 500 → Stripe ponawia; finalize_discount jest idempotentny
          // (aktualizuje tylko 'reserved', licznik rośnie raz), więc reprocessing jest bezpieczny.
          assertNoDbError(finErr, 'finalize_discount');
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        await upsertSubscription(admin, event.data.object as Stripe.Subscription);
        break;
      }
      case 'invoice.paid':
      case 'invoice.payment_succeeded': {
        await recordInvoice(admin, event.data.object as Stripe.Invoice, true);
        break;
      }
      case 'invoice.payment_failed': {
        await recordInvoice(admin, event.data.object as Stripe.Invoice, false);
        break;
      }
      default:
        break;
    }
    // Przetworzono bez błędu → oznacz `completed` (dopiero teraz duplikat będzie pomijany).
    await completeWebhook(admin, inboxId);
    return Response.json({ received: true });
  } catch (err) {
    captureError(err, { area: 'stripe.webhook', type: event.type });
    // 500 → Stripe ponowi dostarczenie. Inbox pozostaje `processing`, więc ponowienie PRZETWORZY
    // ponownie (idempotentnie), zamiast zobaczyć „duplicate" i zgubić zdarzenie.
    return Response.json({ error: 'processing failed' }, { status: 500 });
  }
}
