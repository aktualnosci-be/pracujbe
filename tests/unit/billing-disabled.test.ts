import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDiscount, cancelSubscription, startCheckout } from '@/lib/actions/billing';
import { POST as stripeWebhook } from '@/app/api/stripe/webhook/route';
import { BILLING_FLAG_ENV, isBillingEnabled } from '@/lib/billing/flag';
import { isBillingProviderConfigured } from '@/lib/data/billing';
import { readinessChecks } from '@/lib/env';
import { toUserMessageKey } from '@/lib/errors';
import { getStripe, isBillingProviderReady, isStripeConfigured } from '@/lib/stripe';

function stubStripeSecrets(): void {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_should_not_be_used');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_should_not_be_used');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('flaga BILLING_ENABLED (#51)', () => {
  it('nazwa zmiennej jest stała i jawna', () => {
    expect(BILLING_FLAG_ENV).toBe('BILLING_ENABLED');
  });

  it('domyślnie jest wyłączona', () => {
    vi.stubEnv('BILLING_ENABLED', undefined);
    expect(isBillingEnabled()).toBe(false);
  });

  it.each(['', 'false', '0', '1', 'yes', 'on', 'enabled', 'tru', 'true1'])(
    'wartość %j nie włącza sprzedaży',
    (value) => {
      vi.stubEnv('BILLING_ENABLED', value);
      expect(isBillingEnabled()).toBe(false);
    },
  );

  it.each(['true', 'TRUE', ' true '])('włącza się wyłącznie wartością %j', (value) => {
    vi.stubEnv('BILLING_ENABLED', value);
    expect(isBillingEnabled()).toBe(true);
  });
});

describe('bezpłatny MVP — akcje billingu', () => {
  it('odmawia utworzenia checkoutu nawet przy pozostawionych sekretach Stripe', async () => {
    stubStripeSecrets();

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

  it('kontrola ujemna: bezpośrednie wywołanie checkoutu z włączoną flagą i sekretami nadal odmawia', async () => {
    stubStripeSecrets();
    vi.stubEnv('BILLING_ENABLED', 'true');

    for (const plan of ['starter', 'standard', 'pro', 'nieistniejacy']) {
      await expect(startCheckout(plan, undefined, 'en')).resolves.toEqual({
        ok: false,
        error: 'BILLING_UNAVAILABLE',
      });
    }
    await expect(applyDiscount('PRACUJ10')).resolves.toEqual({ ok: false, error: 'BILLING_UNAVAILABLE' });
    await expect(cancelSubscription()).resolves.toEqual({ ok: false, error: 'BILLING_UNAVAILABLE' });
  });

  it('komunikat BILLING_UNAVAILABLE mówi o bezpłatnym dostępie, nie o chwilowej awarii', () => {
    expect(toUserMessageKey('BILLING_UNAVAILABLE')).toBe('errors.billingDisabled');
  });

  it.each(['pl', 'nl', 'fr', 'en'])(
    'komunikaty BILLING_UNAVAILABLE i ENTITLEMENT_LIMIT w %s nie zachęcają do zakupu planu',
    (locale) => {
      const messages = JSON.parse(
        readFileSync(resolve(process.cwd(), 'src', 'messages', `${locale}.json`), 'utf-8'),
      ) as { errors: Record<string, string> };
      for (const code of ['BILLING_UNAVAILABLE', 'ENTITLEMENT_LIMIT'] as const) {
        const text = messages.errors[toUserMessageKey(code).slice('errors.'.length)];
        expect(text, `${locale}: ${code}`).toBeTruthy();
        expect(text, `${locale}: ${code}`).not.toMatch(
          /plan\b|planie|plan\.|upgrade|zmień plan|kup|buy|achet|koop|abonnement|subscription|subskrypc/i,
        );
      }
    },
  );
});

describe('bezpłatny MVP — webhook Stripe', () => {
  it('przy wyłączonej fladze trasa nie istnieje (404) i niczego nie przetwarza', async () => {
    stubStripeSecrets();

    const response = await stripeWebhook();

    expect(response.status).toBe(404);
  });

  it('przy włączonej fladze nadal odrzuca zdarzenia (410) — brak obsługi w tej wersji', async () => {
    stubStripeSecrets();
    vi.stubEnv('BILLING_ENABLED', 'true');

    const response = await stripeWebhook();

    expect(response.status).toBe(410);
    await expect(response.json()).resolves.toEqual({ error: 'billing disabled' });
  });
});

describe('bezpłatny MVP — klient Stripe nieosiągalny bez flagi', () => {
  it('sekrety Stripe bez flagi nie konfigurują dostawcy ani gotowości', () => {
    stubStripeSecrets();

    expect(getStripe()).toBeNull();
    expect(isStripeConfigured()).toBe(false);
    expect(isBillingProviderReady()).toBe(false);
    expect(isBillingProviderConfigured()).toBe(false);
    expect(readinessChecks().stripe).toBe(false);
  });

  it('kontrola ujemna: z flagą te same sekrety są wykrywane (bramka naprawdę działa)', () => {
    stubStripeSecrets();
    vi.stubEnv('BILLING_ENABLED', 'true');

    expect(isStripeConfigured()).toBe(true);
    expect(isBillingProviderReady()).toBe(true);
    expect(isBillingProviderConfigured()).toBe(true);
    expect(readinessChecks().stripe).toBe(true);
  });
});
