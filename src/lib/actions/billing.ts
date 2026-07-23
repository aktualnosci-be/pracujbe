'use server';

import { z } from 'zod';

import { createServerClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { isSupabaseConfigured } from '@/lib/env';
import type { ErrorCode } from '@/lib/errors';
import { checkRateLimit } from '@/lib/rate-limit';
import { captureError } from '@/lib/sentry';
import { PLAN_IDS, isBillingProviderConfigured } from '@/lib/data/billing';

/**
 * Server Actions płatności/subskrypcji — Pracuj.be (Etap 7h, scaffold PROVIDER-GATED).
 *
 *   - `startCheckout`      — placeholder sesji płatności dostawcy (np. Stripe Checkout).
 *   - `applyDiscount`      — waliduje kod rabatowy w `discount_codes` (bez redempcji).
 *   - `cancelSubscription` — placeholder anulowania subskrypcji u dostawcy.
 *
 * PROVIDER-GATED: bez klucza dostawcy (`STRIPE_SECRET_KEY`) NIE tworzymy realnej płatności —
 * akcje zwracają `{ ok: true, demo: true }`, a UI informuje, że rozliczenia są w przygotowaniu.
 * Ten moduł celowo NIE integruje Stripe (brak klucza) — jest czystym scaffoldem.
 *
 * Błędy mapowane na stabilny `ErrorCode` (Invariant #8, bez technikaliów). Bez env → tryb DEMO
 * (build/UX działa bez backendu).
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

/* ---------------------------------------------------------------------------
 * startCheckout — placeholder sesji płatności (Stripe Checkout w przyszłości)
 * ------------------------------------------------------------------------- */

/**
 * Rozpoczyna „checkout" dla wybranego pakietu. Waliduje identyfikator pakietu, po czym — dopóki
 * dostawca płatności nie jest skonfigurowany — zwraca `{ ok: true, demo: true }` (UI pokaże, że
 * płatności są w przygotowaniu). Miejsce na integrację Stripe Checkout jest oznaczone niżej.
 */
export async function startCheckout(plan: string): Promise<CheckoutResult> {
  if (!PLAN_IDS.has(plan)) return { ok: false, error: 'VALIDATION_FAILED' };

  // Provider-gated: bez klucza dostawcy nie tworzymy realnej sesji płatności.
  if (!isBillingProviderConfigured()) return { ok: true, demo: true };

  // TODO(payments): utworzyć sesję Stripe Checkout dla `plan` i zwrócić `{ ok: true, url }`.
  // Do czasu integracji zachowujemy zachowanie DEMO (brak realnej płatności).
  return { ok: true, demo: true };
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
  if (isSupabaseConfigured()) {
    try {
      const supabase = await createServerClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { ok: false, error: 'PERMISSION_DENIED' };
    } catch (e) {
      captureError(e, { area: 'billing.cancelSubscription' });
      return { ok: false, error: 'INTERNAL' };
    }
  }

  // Provider-gated: realna anulacja u dostawcy — poza zakresem scaffoldu.
  // TODO(payments): wywołać API dostawcy (cancel_at_period_end) i zaktualizować subskrypcję.
  return { ok: true, demo: true };
}
