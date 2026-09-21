'use server';

import type { ErrorCode } from '@/lib/errors';

/**
 * Płatności są celowo wyłączone w bezpłatnym MVP. Akcje pozostają jako stabilna granica
 * serwera dla starszych klientów, ale zawsze odmawiają operacji — także gdy na Railway przez
 * pomyłkę nadal są ustawione sekrety Stripe.
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
