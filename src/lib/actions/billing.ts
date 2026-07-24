'use server';

import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { env, isProductionMode, isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { PLAN_IDS, type BillingPlanId } from '@/lib/data/billing';
import { getStripe, isBillingProviderReady, planPriceData } from '@/lib/stripe';

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
export async function startCheckout(
  plan: string,
  code?: string,
  locale?: string,
): Promise<CheckoutResult> {
  if (!PLAN_IDS.has(plan)) return { ok: false, error: 'VALIDATION_FAILED' };

  const stripe = getStripe();
  if (!isSupabaseConfigured() || !stripe) return { ok: true, demo: true };

  // P0-01: nie inicjuj checkoutu w produkcji bez sekretu webhooka. Webhook jest źródłem prawdy
  // o subskrypcji/fakturach/płatnościach — bez niego checkout pobrałby pieniądze, ale żaden zapis
  // nigdy by się nie zsynchronizował. Fail-closed: czytelny komunikat zamiast cichej utraty.
  if (isProductionMode() && !isBillingProviderReady()) {
    return { ok: false, error: 'BILLING_UNAVAILABLE' };
  }

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

    // P1-16: nie zakładaj drugiej płatnej subskrypcji, gdy firma ma już aktywną/trialing.
    const { data: activeSub } = await admin
      .from('subscriptions')
      .select('id')
      .eq('company_id', ctx.companyId)
      .in('status', ['active', 'trialing'])
      .limit(1);
    if (Array.isArray(activeSub) && activeSub[0]) return { ok: false, error: 'VALIDATION_FAILED' };

    // P1-16: reużyj jednego klienta Stripe firmy — najpierw trwałe companies.provider_customer_id,
    // potem (legacy) z subscriptions; inaczej utwórz i UTRWAL na firmie (koniec duplikatów klientów
    // przy porzuconych checkoutach). Idempotency key chroni przed dubletem przy współbieżności.
    const { data: companyRow } = await admin
      .from('companies')
      .select('provider_customer_id')
      .eq('id', ctx.companyId)
      .maybeSingle();
    let customerId = asStr(asRecord(companyRow)['provider_customer_id']);
    if (!customerId) {
      const { data: existing } = await admin
        .from('subscriptions')
        .select('provider_customer_id')
        .eq('company_id', ctx.companyId)
        .not('provider_customer_id', 'is', null)
        .order('created_at', { ascending: false })
        .limit(1);
      customerId = asStr(asRecord(asArr(existing)[0])['provider_customer_id']);
    }
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email ?? undefined, metadata: { company_id: ctx.companyId } },
        { idempotencyKey: `cust-${ctx.companyId}` },
      );
      customerId = customer.id;
      // P3-04: nie ignoruj błędu zapisu — bez utrwalenia provider_customer_id kolejny checkout
      // utworzyłby duplikat klienta Stripe. Błąd infra = INTERNAL (retryable), nie cichy sukces.
      const { error: custErr } = await admin
        .from('companies')
        .update({ provider_customer_id: customerId })
        .eq('id', ctx.companyId);
      if (custErr) {
        captureError(custErr, { area: 'billing.startCheckout.persistCustomer' });
        return { ok: false, error: 'INTERNAL' };
      }
    }

    // Opcjonalny kod rabatowy → REZERWACJA (P1-15: atomowa, limit + per-firma unikat) → kupon.
    // Nieprawidłowy/wyczerpany kod ZATRZYMUJE checkout czytelnym błędem (koniec cichego pełnopłatu).
    const discounts: { coupon: string }[] = [];
    let discountCodeId: string | null = null;
    if (code) {
      const parsedCode = discountCodeSchema.safeParse(code);
      if (!parsedCode.success) return { ok: false, error: 'VALIDATION_FAILED' };
      const { data: resv, error: resvErr } = await admin.rpc('reserve_discount', {
        p_code: parsedCode.data,
        p_company_id: ctx.companyId,
      });
      if (resvErr) {
        return {
          ok: false,
          error: resvErr.message.includes('VALIDATION_FAILED') ? 'VALIDATION_FAILED' : 'NOT_FOUND',
        };
      }
      const r = asRecord(resv);
      const percentOff = typeof r['percent_off'] === 'number' ? r['percent_off'] : 0;
      const amountOff = typeof r['amount_off_cents'] === 'number' ? r['amount_off_cents'] : 0;
      discountCodeId = asStr(r['code_id']) || null;
      const coupon =
        percentOff > 0
          ? await stripe.coupons.create({ duration: 'once', percent_off: percentOff })
          : await stripe.coupons.create({
              duration: 'once',
              amount_off: amountOff,
              currency: (asStr(r['currency']) || price.currency).toLowerCase(),
            });
      discounts.push({ coupon: coupon.id });
    }

    // P0-02: serwerowa idempotencja startu checkoutu. begin_checkout serializuje w BAZIE
    // (advisory lock + partial-unique 'pending' per firma + kontrola aktywnej subskrypcji) —
    // dwa równoległe żądania nie utworzą dwóch sesji/subskrypcji. Zwraca stabilny intent_id,
    // którego używamy jako idempotency key Stripe.
    const { data: intentData, error: intentErr } = await admin.rpc('begin_checkout', {
      p_company_id: ctx.companyId,
      p_plan: plan,
    });
    if (intentErr) {
      const msg = intentErr.message ?? '';
      if (msg.includes('CHECKOUT_IN_PROGRESS')) return { ok: false, error: 'CHECKOUT_IN_PROGRESS' };
      if (msg.includes('ACTIVE_SUBSCRIPTION')) return { ok: false, error: 'VALIDATION_FAILED' };
      if (msg.includes('VALIDATION_FAILED')) return { ok: false, error: 'VALIDATION_FAILED' };
      captureError(intentErr, { area: 'billing.startCheckout.beginCheckout' });
      return { ok: false, error: 'INTERNAL' };
    }
    const intentId = asStr(intentData);
    if (!intentId) return { ok: false, error: 'INTERNAL' };

    const base = env.siteUrl;
    // P1-16: URL-e sukcesu/anulowania w języku użytkownika (było na sztywno /pl).
    const { routing } = await import('@/i18n/routing');
    const loc = (routing.locales as readonly string[]).includes(locale ?? '')
      ? (locale as string)
      : routing.defaultLocale;

    let session: Awaited<ReturnType<typeof stripe.checkout.sessions.create>>;
    try {
      session = await stripe.checkout.sessions.create(
        {
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
          // checkout_intent_id → webhook checkout.session.completed domyka intent (P0-02);
          // discount_code_id → finalizacja rezerwacji kodu (P1-15).
          metadata: {
            company_id: ctx.companyId,
            plan,
            checkout_intent_id: intentId,
            ...(discountCodeId ? { discount_code_id: discountCodeId } : {}),
          },
          subscription_data: { metadata: { company_id: ctx.companyId, plan } },
          success_url: `${base}/${loc}/employer/platnosci?checkout=success`,
          cancel_url: `${base}/${loc}/employer/platnosci?checkout=cancel`,
        },
        // Stabilny klucz idempotencji: powtórka tego samego intentu zwraca tę samą sesję Stripe.
        { idempotencyKey: `subscription-checkout:${ctx.companyId}:${intentId}` },
      );
    } catch (stripeErr) {
      // Błąd API Stripe — zwolnij intent, by użytkownik mógł natychmiast spróbować ponownie.
      await admin.rpc('release_checkout_intent', { p_intent_id: intentId });
      throw stripeErr;
    }
    if (!session.url) {
      await admin.rpc('release_checkout_intent', { p_intent_id: intentId });
      return { ok: false, error: 'INTERNAL' };
    }
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
    const { data, error: selErr } = await admin
      .from('subscriptions')
      .select('provider_subscription_id')
      .eq('company_id', ctx.companyId)
      .in('status', ['active', 'trialing', 'past_due'])
      .not('provider_subscription_id', 'is', null)
      .order('created_at', { ascending: false })
      .limit(1);
    // P3-04: rozróżnij błąd infra (INTERNAL, retryable) od realnego braku subskrypcji (NOT_FOUND).
    if (selErr) {
      captureError(selErr, { area: 'billing.cancelSubscription.select' });
      return { ok: false, error: 'INTERNAL' };
    }
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
