'use server';

import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env, isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { PLAN_IDS, type BillingPlanId } from '@/lib/data/billing';
import { getStripe, planPriceData } from '@/lib/stripe';

/**
 * Server Actions płatności/subskrypcji — Pracuj.be (Etap 7h, REALNY Stripe, provider-gated).
 *
 *   - `startCheckout`      — tworzy realną sesję Stripe Checkout (subskrypcja) i zwraca URL.
 *   - `applyDiscount`      — waliduje kod rabatowy w `discount_codes` (bez redempcji).
 *   - `cancelSubscription` — anuluje subskrypcję u dostawcy (cancel_at_period_end).
 *
 * PROVIDER-GATED: bez `STRIPE_SECRET_KEY` (albo bez env) akcje zwracają `{ ok: true, demo: true }`,
 * a UI informuje, że rozliczenia są w przygotowaniu. ŹRÓDŁEM PRAWDY o stanie subskrypcji/faktur/
 * płatności jest webhook `/api/stripe/webhook` (zapis service-rolem) — akcje tylko inicjują operacje.
 * Billing = rola owner/admin (capability). Błędy → stabilny `ErrorCode` (Invariant #8, bez technikaliów).
 */

export type CheckoutResult =
  | { ok: true; demo?: boolean; url?: string }
  | { ok: false; error: ErrorCode };

export type DiscountResult =
  | { ok: true; percentOff?: number; amountOffCents?: number; currency?: string; demo?: boolean }
  | { ok: false; error: ErrorCode };

export type CancelResult = { ok: true; demo?: boolean } | { ok: false; error: ErrorCode };

/** Kod rabatowy działający w trybie DEMO (bez env) — do prezentacji przepływu. */
const DEMO_DISCOUNT_CODE = 'PRACUJ10';
const DEMO_DISCOUNT_PERCENT = 10;

/** Format kodu rabatowego: alfanumeryczny start + [A-Z0-9_-]. Normalizacja do wielkich liter. */
const discountCodeSchema = z
  .string()
  .trim()
  .min(2, 'VALIDATION_FAILED')
  .max(40, 'VALIDATION_FAILED')
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, 'VALIDATION_FAILED');

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}
function asArr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asStr(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/** Aktywna firma + rola billingowa (owner/admin). Zwraca null, gdy brak uprawnień. */
async function billingContext(
  supabase: Awaited<ReturnType<typeof createServerClient>>,
  userId: string,
): Promise<{ companyId: string } | null> {
  const { getActiveCompany } = await import('@/lib/company-context');
  const ctx = await getActiveCompany(supabase, userId);
  if (!ctx.activeId) return null;
  if (ctx.activeRole !== 'owner' && ctx.activeRole !== 'admin') return null; // can_manage_billing
  return { companyId: ctx.activeId };
}

/* ---------------------------------------------------------------------------
 * startCheckout — placeholder sesji płatności (Stripe Checkout w przyszłości)
 * ------------------------------------------------------------------------- */

/**
 * Tworzy realną sesję Stripe Checkout (subskrypcja miesięczna) dla wybranego pakietu i zwraca URL.
 * Cena z `PLANS` (inline price_data). Opcjonalny kod rabatowy → efemeryczny kupon Stripe. Wymaga
 * roli owner/admin. Provider-gated: bez klucza/env → `{ ok: true, demo: true }`.
 */
export async function startCheckout(plan: string, code?: string): Promise<CheckoutResult> {
  if (!PLAN_IDS.has(plan)) return { ok: false, error: 'VALIDATION_FAILED' };

  const stripe = getStripe();
  if (!isSupabaseConfigured() || !stripe) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const ctx = await billingContext(supabase, user.id);
    if (!ctx) return { ok: false, error: 'PERMISSION_DENIED' };

    if (!(await checkRateLimit('checkout', { identifier: user.id, max: 20, windowSeconds: 3600 }))) {
      return { ok: false, error: 'RATE_LIMITED' };
    }

    const price = planPriceData(plan as BillingPlanId);
    if (!price) return { ok: false, error: 'VALIDATION_FAILED' };

    const admin = createAdminClient();

    // Reużyj istniejącego Stripe customer firmy; inaczej utwórz nowego (metadata = company_id).
    const { data: existing } = await admin
      .from('subscriptions')
      .select('provider_customer_id')
      .eq('company_id', ctx.companyId)
      .not('provider_customer_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    let customerId = asStr(asRecord(asArr(existing)[0])['provider_customer_id']);
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { company_id: ctx.companyId },
      });
      customerId = customer.id;
    }

    // Opcjonalny kod rabatowy → efemeryczny kupon (once). Zniżka procentowa lub kwotowa.
    const discounts: { coupon: string }[] = [];
    if (code) {
      const disc = await applyDiscount(code);
      if (disc.ok && (disc.percentOff || disc.amountOffCents)) {
        const coupon = disc.percentOff
          ? await stripe.coupons.create({ duration: 'once', percent_off: disc.percentOff })
          : await stripe.coupons.create({
              duration: 'once',
              amount_off: disc.amountOffCents as number,
              currency: (disc.currency ?? price.currency).toLowerCase(),
            });
        discounts.push({ coupon: coupon.id });
      }
    }

    const base = env.siteUrl;
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: price.currency,
            unit_amount: price.unitAmount,
            recurring: { interval: 'month' },
            product_data: { name: `Pracuj.be — ${plan}` },
          },
        },
      ],
      ...(discounts.length ? { discounts } : { allow_promotion_codes: true }),
      metadata: { company_id: ctx.companyId, plan },
      subscription_data: { metadata: { company_id: ctx.companyId, plan } },
      success_url: `${base}/pl/employer/platnosci?checkout=success`,
      cancel_url: `${base}/pl/employer/platnosci?checkout=cancel`,
    });
    if (!session.url) return { ok: false, error: 'INTERNAL' };
    return { ok: true, url: session.url };
  } catch (e) {
    captureError(e, { area: 'billing.startCheckout' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * applyDiscount — walidacja kodu rabatowego (bez redempcji)
 * ------------------------------------------------------------------------- */

/**
 * Waliduje kod rabatowy i zwraca zniżkę (procentową lub kwotową). NIE zapisuje redempcji —
 * faktyczne zastosowanie nastąpi przy realnym checkoutcie u dostawcy.
 *
 * `discount_codes` ma RLS bez polityk (deny dla authenticated), więc kod czytamy service-rolem —
 * ale dopiero po potwierdzeniu, że żądanie pochodzi od zalogowanego użytkownika (ochrona przed
 * sondowaniem kodów). Rate limit per IP.
 */
export async function applyDiscount(code: string): Promise<DiscountResult> {
  const parsed = discountCodeSchema.safeParse(code);
  if (!parsed.success) return { ok: false, error: 'VALIDATION_FAILED' };
  const normalized = parsed.data.toUpperCase();

  if (!(await checkRateLimit('discount-apply', { max: 20, windowSeconds: 3600 }))) {
    return { ok: false, error: 'RATE_LIMITED' };
  }

  // Tryb DEMO (brak env): jeden przykładowy kod działa, by zaprezentować przepływ.
  if (!isSupabaseConfigured()) {
    if (normalized === DEMO_DISCOUNT_CODE) {
      return { ok: true, percentOff: DEMO_DISCOUNT_PERCENT, demo: true };
    }
    return { ok: false, error: 'NOT_FOUND' };
  }

  try {
    // Wymagamy zalogowanego użytkownika (kod czytany service-rolem — chronimy przed sondowaniem).
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    // discount_codes: RLS deny → odczyt service-rolem (tylko walidacja, bez inkrementacji redempcji).
    const admin = createAdminClient();
    const { data, error } = await admin
      .from('discount_codes')
      .select(
        'percent_off, amount_off_cents, currency, is_active, valid_from, valid_until, max_redemptions, times_redeemed',
      )
      .eq('code', normalized)
      .maybeSingle();
    if (error) return { ok: false, error: 'INTERNAL' };
    if (!data) return { ok: false, error: 'NOT_FOUND' };

    const row = asRecord(data);
    const nowMs = Date.now();

    const isActive = row['is_active'] === true;
    const fromRaw = typeof row['valid_from'] === 'string' ? Date.parse(row['valid_from']) : null;
    const untilRaw = typeof row['valid_until'] === 'string' ? Date.parse(row['valid_until']) : null;
    const from = fromRaw !== null && !Number.isNaN(fromRaw) ? fromRaw : null;
    const until = untilRaw !== null && !Number.isNaN(untilRaw) ? untilRaw : null;
    const withinWindow = (from === null || from <= nowMs) && (until === null || nowMs <= until);

    const maxRedemptions =
      typeof row['max_redemptions'] === 'number' ? row['max_redemptions'] : null;
    const timesRedeemed = typeof row['times_redeemed'] === 'number' ? row['times_redeemed'] : 0;
    const hasRedemptionsLeft = maxRedemptions === null || timesRedeemed < maxRedemptions;

    if (!isActive || !withinWindow || !hasRedemptionsLeft) {
      return { ok: false, error: 'NOT_FOUND' };
    }

    const percentOff = typeof row['percent_off'] === 'number' ? row['percent_off'] : undefined;
    const amountOffCents =
      typeof row['amount_off_cents'] === 'number' ? row['amount_off_cents'] : undefined;
    const currency = typeof row['currency'] === 'string' ? row['currency'] : undefined;

    // Preferujemy zniżkę procentową; w innym wypadku kwotową (z walutą).
    if (percentOff !== undefined && percentOff > 0) {
      return { ok: true, percentOff };
    }
    if (amountOffCents !== undefined && amountOffCents > 0) {
      return currency
        ? { ok: true, amountOffCents, currency }
        : { ok: true, amountOffCents };
    }

    // Kod istnieje, ale nie niesie realnej zniżki — traktujemy jak nieprawidłowy.
    return { ok: false, error: 'NOT_FOUND' };
  } catch (e) {
    captureError(e, { area: 'billing.applyDiscount' });
    return { ok: false, error: 'INTERNAL' };
  }
}

/* ---------------------------------------------------------------------------
 * cancelSubscription — placeholder anulowania u dostawcy
 * ------------------------------------------------------------------------- */

/**
 * Anuluje subskrypcję firmy. Provider-gated: realna anulacja wymaga dostawcy, więc dopóki nie jest
 * skonfigurowany, zwracamy `{ ok: true, demo: true }`. Przy skonfigurowanym Supabase weryfikujemy
 * jedynie, że żądanie pochodzi od zalogowanego użytkownika (lekki guard).
 */
export async function cancelSubscription(): Promise<CancelResult> {
  const stripe = getStripe();
  if (!isSupabaseConfigured() || !stripe) return { ok: true, demo: true };

  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { ok: false, error: 'PERMISSION_DENIED' };

    const ctx = await billingContext(supabase, user.id);
    if (!ctx) return { ok: false, error: 'PERMISSION_DENIED' };

    const admin = createAdminClient();
    const { data } = await admin
      .from('subscriptions')
      .select('provider_subscription_id')
      .eq('company_id', ctx.companyId)
      .in('status', ['active', 'trialing', 'past_due'])
      .not('provider_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    const subId = asStr(asRecord(asArr(data)[0])['provider_subscription_id']);
    if (!subId) return { ok: false, error: 'NOT_FOUND' };

    // cancel_at_period_end: użytkownik zachowuje dostęp do końca okresu. Stan zsynchronizuje
    // webhook customer.subscription.updated (źródło prawdy).
    await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    return { ok: true };
  } catch (e) {
    captureError(e, { area: 'billing.cancelSubscription' });
    return { ok: false, error: 'INTERNAL' };
  }
}
