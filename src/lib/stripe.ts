import 'server-only';

import Stripe from 'stripe';

import { PLANS, type BillingPlanId } from '@/lib/data/billing';

/**
 * Klient Stripe (server-only) + mapowanie pakietów. PROVIDER-GATED: bez `STRIPE_SECRET_KEY`
 * `getStripe()` zwraca null (tryb demo — UI „w przygotowaniu"). Klucz nie jest `NEXT_PUBLIC_*`.
 *
 * Ceny bierzemy z `PLANS` (inline `price_data`, subskrypcja miesięczna) — dzięki temu integracja
 * działa mając wyłącznie `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`, bez ręcznego zakładania
 * Price w dashboardzie Stripe. Webhook (`/api/stripe/webhook`) jest ŹRÓDŁEM PRAWDY o stanie
 * subskrypcji/faktur/płatności (zapis service-rolem).
 */

let cached: Stripe | null = null;

export function isStripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!cached) {
    cached = new Stripe(process.env.STRIPE_SECRET_KEY, {
      // apiVersion pominięte świadomie → SDK używa wersji konta (brak ryzyka złego stringa).
      typescript: true,
      appInfo: { name: 'Pracuj.be' },
    });
  }
  return cached;
}

/** Dane cenowe pakietu (grosze + waluta) do inline `price_data` w Checkout. */
export function planPriceData(plan: BillingPlanId): { unitAmount: number; currency: string } | null {
  const p = PLANS.find((x) => x.id === plan);
  if (!p) return null;
  return { unitAmount: p.priceCents, currency: p.currency.toLowerCase() };
}
