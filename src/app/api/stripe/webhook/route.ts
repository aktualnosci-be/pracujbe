import type Stripe from 'stripe';

import { getStripe } from '@/lib/stripe';
import { createAdminClient } from '@/lib/supabase/admin';
import { captureError } from '@/lib/sentry';

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

/** Upsert subskrypcji po provider_subscription_id (insert/update, bez unikatu w schemacie). */
async function upsertSubscription(admin: Admin, sub: Stripe.Subscription): Promise<void> {
  const company = sub.metadata?.['company_id'];
  if (!company) return; // brak mapowania firmy → nic nie zapisujemy

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

  const { data } = await admin
    .from('subscriptions')
    .select('id')
    .eq('provider_subscription_id', sub.id)
    .limit(1);
  const existingId = Array.isArray(data) && data[0] ? (data[0] as { id?: string }).id : undefined;
  if (existingId) {
    await admin.from('subscriptions').update(row).eq('id', existingId);
  } else {
    await admin.from('subscriptions').insert(row);
  }
}

/** Zapisuje fakturę + płatność (best-effort) po opłaceniu/niepowodzeniu faktury. */
async function recordInvoice(admin: Admin, invoice: Stripe.Invoice, paid: boolean): Promise<void> {
  if (!invoice.number) return; // rejestrujemy tylko sfinalizowane faktury (unikat number)
  const stripeSubId =
    typeof (invoice as unknown as { subscription?: unknown }).subscription === 'string'
      ? ((invoice as unknown as { subscription?: string }).subscription as string)
      : null;

  let companyId: string | null = null;
  let ourSubId: string | null = null;
  if (stripeSubId) {
    const { data } = await admin
      .from('subscriptions')
      .select('id, company_id')
      .eq('provider_subscription_id', stripeSubId)
      .limit(1);
    const r = Array.isArray(data) && data[0] ? (data[0] as { id?: string; company_id?: string }) : null;
    if (r) {
      ourSubId = r.id ?? null;
      companyId = r.company_id ?? null;
    }
  }
  if (!companyId) return;

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
  const { data: invData } = await admin.from('invoices').select('id').eq('number', invoice.number).limit(1);
  const invId = Array.isArray(invData) && invData[0] ? (invData[0] as { id?: string }).id : undefined;
  let invoiceUuid = invId;
  if (invId) {
    await admin.from('invoices').update(invoiceRow).eq('id', invId);
  } else {
    const { data: ins } = await admin.from('invoices').insert(invoiceRow).select('id').limit(1);
    invoiceUuid = Array.isArray(ins) && ins[0] ? (ins[0] as { id?: string }).id : undefined;
  }

  const pi = (invoice as unknown as { payment_intent?: unknown }).payment_intent;
  const providerPaymentId = typeof pi === 'string' ? pi : null;
  await admin.from('payments').insert({
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
}

export async function POST(request: Request): Promise<Response> {
  const stripe = getStripe();
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  // Bez konfiguracji webhook nie powinien być wołany — no-op 200 (nie ujawniamy szczegółów).
  if (!stripe || !secret) return Response.json({ ok: true, skipped: true });

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

  try {
    const admin = createAdminClient();

    // SEC-14: dedup po event.id (anty-replay). Pierwszy insert wygrywa; duplikat → 200 no-op.
    const { error: dupErr } = await admin
      .from('processed_webhooks')
      .insert({ id: `stripe:${event.id}`, source: 'stripe' });
    if (dupErr) {
      if ((dupErr as { code?: string }).code === '23505') {
        return Response.json({ received: true, duplicate: true });
      }
      captureError(dupErr, { area: 'stripe.webhook.dedup', type: event.type });
      // best-effort: przy innym błędzie dedup przetwarzamy dalej (zapisy są idempotentne).
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId = typeof session.subscription === 'string' ? session.subscription : null;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await upsertSubscription(admin, sub);
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
    return Response.json({ received: true });
  } catch (err) {
    captureError(err, { area: 'stripe.webhook', type: event.type });
    // 500 → Stripe ponowi dostarczenie (webhook jest idempotentny po stronie zapisu).
    return Response.json({ error: 'processing failed' }, { status: 500 });
  }
}
