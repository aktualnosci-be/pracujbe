import { readFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { applyDiscount, cancelSubscription, startCheckout } from '@/lib/actions/billing';
import { POST as stripeWebhook } from '@/app/api/stripe/webhook/route';
import { BILLING_FLAG_ENV, isBillingEnabled, isBillingFlagSet } from '@/lib/billing/flag';
import { isBillingProviderConfigured, PLANS } from '@/lib/data/billing';
import { readinessChecks } from '@/lib/env';
import { toUserMessageKey } from '@/lib/errors';
import { getStripe, isBillingProviderReady, isStripeConfigured } from '@/lib/stripe';
import { PORTAL_LEGAL_MODE_ENV } from '@/lib/portal-mode';

import { withClassifiedsMode, withRecruitmentMode } from '../helpers/portal-mode';

function stubStripeSecrets(): void {
  vi.stubEnv('STRIPE_SECRET_KEY', 'sk_test_should_not_be_used');
  vi.stubEnv('STRIPE_WEBHOOK_SECRET', 'whsec_should_not_be_used');
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('flaga BILLING_ENABLED (#51)', () => {
  // Zachowanie flagi w trybie rekrutacyjnym; tryb ogłoszeniowy — osobny blok niżej (#1153).
  withRecruitmentMode();

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
  // Zachowanie flagi w trybie rekrutacyjnym; tryb ogłoszeniowy — osobny blok niżej (#1153).
  withRecruitmentMode();

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
  // Zachowanie flagi w trybie rekrutacyjnym; tryb ogłoszeniowy — osobny blok niżej (#1153).
  withRecruitmentMode();

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
  // Zachowanie flagi w trybie rekrutacyjnym; tryb ogłoszeniowy — osobny blok niżej (#1153).
  withRecruitmentMode();

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

describe('tryb ogłoszeniowy (#1153) — billing nieaktywny mimo flagi i sekretów', () => {
  withClassifiedsMode();

  it('BILLING_ENABLED=true + sekrety Stripe: flaga, klient, dostawca i gotowość wyłączone', async () => {
    stubStripeSecrets();
    vi.stubEnv('BILLING_ENABLED', 'true');

    expect(isBillingFlagSet()).toBe(true);
    expect(isBillingEnabled()).toBe(false);
    expect(getStripe()).toBeNull();
    expect(isStripeConfigured()).toBe(false);
    expect(isBillingProviderReady()).toBe(false);
    expect(isBillingProviderConfigured()).toBe(false);
    expect(readinessChecks().stripe).toBe(false);
    expect((await stripeWebhook()).status).toBe(404);
    await expect(startCheckout('standard', undefined, 'pl')).resolves.toEqual({
      ok: false,
      error: 'BILLING_UNAVAILABLE',
    });
  });

  it.each(['', 'true', '1', 'recruitmentt', 'CLASSIFIEDS_ONLY'])(
    'wartość trybu %j (nie RECRUITMENT) nie włącza billingu',
    (mode) => {
      vi.stubEnv(PORTAL_LEGAL_MODE_ENV, mode);
      vi.stubEnv('BILLING_ENABLED', 'true');
      expect(isBillingEnabled()).toBe(false);
    },
  );

  it('kontrola ujemna: bramka trybu naprawdę działa — ta sama flaga w trybie RECRUITMENT włącza billing', () => {
    stubStripeSecrets();
    vi.stubEnv('BILLING_ENABLED', 'true');
    vi.stubEnv(PORTAL_LEGAL_MODE_ENV, 'RECRUITMENT');
    expect(isBillingEnabled()).toBe(true);
    expect(isStripeConfigured()).toBe(true);
  });

  it('flag.ts łączy flagę z trybem produktu (usunięcie bramki = czerwony)', () => {
    const source = readFileSync(resolve(__dirname, '../../src/lib/billing/flag.ts'), 'utf8');
    expect(source).toMatch(/return isRecruitmentEnabled\(\) && isBillingFlagSet\(\);/);
  });
});

describe('katalog sprzedaży bez dostępu do kandydatów (#1153)', () => {
  const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
  const messages = (locale: string) =>
    JSON.parse(readFileSync(resolve(__dirname, `../../src/messages/${locale}.json`), 'utf8')) as Record<
      string,
      Record<string, unknown>
    >;
  const REMOVED = [
    ['billing', 'standardFeat3'],
    ['billing', 'proFeat3'],
    ['dashboard', 'featCvAccess'],
  ] as const;
  // Opis płatnego dostępu do bazy kandydatów/CV w dowolnym języku portalu.
  const CANDIDATE_ACCESS = /bazy CV|baza CV|cv-databank|cv-database|base de CV|CV database/i;

  it.each(LOCALES)('%s: brak martwych kluczy sprzedaży dostępu do bazy CV', (locale) => {
    const m = messages(locale);
    for (const [ns, key] of REMOVED) expect(m[ns]?.[key], `${ns}.${key}`).toBeUndefined();
    for (const ns of ['billing', 'pricing', 'dashboard']) {
      const offenders = Object.entries(m[ns] ?? {})
        .filter(([, v]) => typeof v === 'string' && CANDIDATE_ACCESS.test(v))
        .map(([k]) => k);
      expect(offenders, ns).toEqual([]);
    }
  });

  it('kontrola ujemna: dawny tekst „Dostęp do bazy CV” byłby wykryty', () => {
    expect('Dostęp do bazy CV').toMatch(CANDIDATE_ACCESS);
    expect('Toegang tot de cv-databank').toMatch(CANDIDATE_ACCESS);
    expect('Accès à la base de CV').toMatch(CANDIDATE_ACCESS);
    expect('Full access to the CV database').toMatch(CANDIDATE_ACCESS);
  });

  it.each(LOCALES)('%s: każda cecha pakietu w PLANS ma tekst (brak osieroconych kluczy)', (locale) => {
    const billing = messages(locale)['billing'] ?? {};
    for (const plan of PLANS) for (const key of plan.features) expect(typeof billing[key], key).toBe('string');
  });
});
