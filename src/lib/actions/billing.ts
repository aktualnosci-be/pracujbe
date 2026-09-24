'use server';

import type { ErrorCode } from '@/lib/errors';

/**
 * Płatności są wyłączone w bezpłatnym MVP (#51, flaga `BILLING_ENABLED`, domyślnie wyłączona —
 * `src/lib/billing/flag.ts`). Akcje pozostają jako stabilna granica serwera dla starszych
 * klientów i ZAWSZE odmawiają, niezależnie od flagi i sekretów Stripe: ta wersja nie zawiera
 * przepływu checkoutu, a jego powrót to osobny projekt po decyzji właściciela.
 */

export type CheckoutResult = { ok: false; error: ErrorCode };
export type DiscountResult = { ok: false; error: ErrorCode };
export type CancelResult = { ok: false; error: ErrorCode };

export async function startCheckout(_plan: string, _code?: string, _locale?: string): Promise<CheckoutResult> {
  return { ok: false, error: 'BILLING_UNAVAILABLE' };
}

export async function applyDiscount(_code: string): Promise<DiscountResult> {
  return { ok: false, error: 'BILLING_UNAVAILABLE' };
}

export async function cancelSubscription(): Promise<CancelResult> {
  return { ok: false, error: 'BILLING_UNAVAILABLE' };
}
