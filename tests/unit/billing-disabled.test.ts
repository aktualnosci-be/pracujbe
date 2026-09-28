import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { readinessChecks } from '@/lib/env';
import { toUserMessageKey } from '@/lib/errors';

/**
 * Bezpłatny MVP (#51): płatności są usunięte, nie tylko wyłączone. Kod checkoutu, klient Stripe,
 * trasa webhooka, flaga `BILLING_ENABLED` i odczyty tabel billingu zniknęły razem z schematem
 * (migracja 0177). Ten strażnik pilnuje, żeby nie wróciły „przy okazji”; powrót monetyzacji to
 * nowa decyzja właściciela i osobny projekt.
 */

const ROOT = process.cwd();

/** Odwołania do usuniętych tabel/RPC billingu w kodzie źródłowym (SQL w stringach). */
const BILLING_SQL_REFERENCE =
  /\b(?:public\.)?(?:subscriptions|invoices|payments|discount_codes|checkout_intents|discount_redemptions)\b|\b(?:reserve_discount|finalize_discount|begin_checkout|complete_checkout|release_checkout_intent|release_stale_(?:discount_reservations|checkout_intents))\b|provider_customer_id/;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(path);
  }
  return out;
}

describe('płatności usunięte (#51, migracja 0177)', () => {
  it.each([
    'src/lib/stripe.ts',
    'src/lib/billing/flag.ts',
    'src/lib/data/billing.ts',
    'src/lib/actions/billing.ts',
    'src/app/api/stripe/webhook/route.ts',
  ])('plik %s nie istnieje', (file) => {
    expect(existsSync(resolve(ROOT, file))).toBe(false);
  });

  it('gotowość aplikacji nie ma już czujki Stripe', () => {
    expect(readinessChecks()).not.toHaveProperty('stripe');
  });

  it('kod źródłowy nie importuje Stripe ani nie czyta zmiennych STRIPE_*/BILLING_ENABLED', () => {
    const offenders = sourceFiles(resolve(ROOT, 'src')).filter((file) => {
      const text = readFileSync(file, 'utf-8');
      return /from\s+['"]stripe['"]|process\.env\.(?:STRIPE_|BILLING_ENABLED)|BILLING_ENABLED/.test(text);
    });
    expect(offenders).toEqual([]);
  });

  it('kod źródłowy nie odwołuje się do usuniętych tabel i funkcji billingu', () => {
    const offenders = sourceFiles(resolve(ROOT, 'src'))
      .filter((file) => BILLING_SQL_REFERENCE.test(readFileSync(file, 'utf-8')))
      .map((file) => file.slice(ROOT.length + 1));
    expect(offenders).toEqual([]);
  });

  it('kontrola ujemna: wzorzec strażnika łapie stare odczyty billingu', () => {
    for (const sql of [
      'SELECT id FROM public.subscriptions WHERE company_id = $1',
      'select * from invoices',
      "rpc(tx, 'begin_checkout', {})",
      "rpc(tx, 'release_stale_discount_reservations')",
      'UPDATE companies SET provider_customer_id = $1',
    ]) {
      expect(BILLING_SQL_REFERENCE.test(sql), sql).toBe(true);
    }
    expect(BILLING_SQL_REFERENCE.test('SELECT id FROM public.jobs')).toBe(false);
  });
});

describe('bezpłatny MVP — komunikaty', () => {
  it('komunikat BILLING_UNAVAILABLE mówi o bezpłatnym dostępie, nie o chwilowej awarii', () => {
    expect(toUserMessageKey('BILLING_UNAVAILABLE')).toBe('errors.billingDisabled');
  });

  it.each(['pl', 'nl', 'fr', 'en'])(
    'komunikaty BILLING_UNAVAILABLE i ENTITLEMENT_LIMIT w %s nie zachęcają do zakupu planu',
    (locale) => {
      const messages = JSON.parse(
        readFileSync(resolve(ROOT, 'src', 'messages', `${locale}.json`), 'utf-8'),
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
