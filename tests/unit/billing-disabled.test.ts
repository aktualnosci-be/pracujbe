import { describe, expect, it, vi } from 'vitest';

import { applyDiscount, cancelSubscription, startCheckout } from '@/lib/actions/billing';
import { POST as stripeWebhook } from '@/app/api/stripe/webhook/route';

describe('bezpłatny MVP', () => {
  it('odmawia utworzenia checkoutu nawet przy pozostawionych sekretach Stripe', async () => {
    vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_should_not_be_used');
    vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_should_not_be_used');

    await expect(startCheckout('standard', 'PRACUJ10', 'pl')).resolves.toEqual({
      ok: false,
      error: 'BILLING_UNAVAILABLE',
    });
    await expect(applyDiscount('PRACUJ10')).resolves.toEqual({
      ok: false,
      error: 'BILLING_UNAVAILABLE',
    });
    await expect(cancelSubscription()).resolves.toEqual({
      ok: false,
      error: 'BILLING_UNAVAILABLE',
    });
  });

  it('odrzuca sprzedażowy webhook bez czytania i przetwarzania zdarzenia', async () => {
    const response = await stripeWebhook();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({
      error: 'billing disabled',
    });
  });
});
