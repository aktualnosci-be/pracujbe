import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { EMAIL_TYPES } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import {
  AUTH_EMAIL_TYPES,
  GUEST_EMAIL_TYPES,
  QUEUED_EMAIL_TYPES,
  UNWIRED_EMAIL_TYPES,
} from '@/emails/wiring';
import { buildDeliveryData } from '@/lib/email/delivery-data';

/**
 * #295 — każdy szablon ma zdarzenie, które go wysyła, albo jest jawnie oznaczony jako
 * nieużywany. Test czyta migracje SQL: typ z kolejki musi występować w wywołaniu
 * `enqueue_email`, a typ nieużywany — nigdzie (kontrola ujemna).
 */

const ROOT = resolve(__dirname, '../..');
const MIGRATIONS = resolve(ROOT, 'supabase/migrations');
const SQL = readdirSync(MIGRATIONS)
  .filter((f) => f.endsWith('.sql'))
  .map((f) => readFileSync(resolve(MIGRATIONS, f), 'utf8'))
  .join('\n');
const AUTH_SOURCE = readFileSync(resolve(ROOT, 'src/lib/auth/email-outbox.ts'), 'utf8');

/** Czy w SQL jest wywołanie `enqueue_email(...)`, którego argumenty zawierają `'type'`. */
function enqueuedIn(sql: string, type: string): boolean {
  // `enqueue_email_to_address` (0094) — ta sama kolejka, jawny adres odbiorcy bez konta.
  const calls = sql.match(/enqueue_email(?:_to_address)?\([^;]*?\)\s*;/gs) ?? [];
  return calls.some((call) => call.includes(`'${type}'`));
}

/** #98: e-maile do gościa bez profilu idą przez `enqueue_guest_email(...)`. */
function guestEnqueuedIn(sql: string, type: string): boolean {
  const calls = sql.match(/enqueue_(?:guest|team_invitation_signup)_email\([^;]*?\)\s*;/gs) ?? [];
  return calls.some((call) => call.includes(`'${type}'`));
}

const UNWIRED = Object.keys(UNWIRED_EMAIL_TYPES);
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

describe('#295: pokrycie szablonów e-mail zdarzeniami', () => {
  it('każdy typ należy do dokładnie jednej grupy', () => {
    const all = [...QUEUED_EMAIL_TYPES, ...GUEST_EMAIL_TYPES, ...AUTH_EMAIL_TYPES, ...UNWIRED];
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual([...EMAIL_TYPES].sort());
  });

  it.each(QUEUED_EMAIL_TYPES)('%s jest kolejkowany przez RPC', (type) => {
    expect(enqueuedIn(SQL, type)).toBe(true);
  });

  it.each(GUEST_EMAIL_TYPES)('%s jest kolejkowany na adres bez konta (0095/0121)', (type) => {
    expect(guestEnqueuedIn(SQL, type)).toBe(true);
    // Nie przez enqueue_email: gość nie ma profilu, z którego enqueue_email bierze adres.
    expect(enqueuedIn(SQL, type)).toBe(false);
  });

  it.each(UNWIRED)('%s nie jest nigdzie kolejkowany (świadomie nieużywany)', (type) => {
    expect(enqueuedIn(SQL, type)).toBe(false);
    expect(guestEnqueuedIn(SQL, type)).toBe(false);
    expect(AUTH_SOURCE.includes(`'${type}'`)).toBe(false);
  });

  it.each(AUTH_EMAIL_TYPES)('%s jest obsługiwany przez warstwę Auth', (type) => {
    expect(AUTH_SOURCE.includes(`'${type}'`)).toBe(true);
  });

  it('kontrola ujemna detektora: brak typu w wywołaniu → false', () => {
    const sample = "perform public.enqueue_email(v_uid, 'statusChanged', 'application', v_id, 'k', '{}');";
    expect(enqueuedIn(sample, 'statusChanged')).toBe(true);
    expect(enqueuedIn(sample, 'applicationViewed')).toBe(false);
    expect(enqueuedIn("select 'jobExpiring';", 'jobExpiring')).toBe(false);
  });
});

describe('#295: nowo podpięte szablony w języku odbiorcy', () => {
  const SITE = 'https://pracuj.be';
  const cases = LOCALES.flatMap((locale) => [
    { locale, template: 'applicationViewed' as const, path: '/candidate/aplikacje' },
    { locale, template: 'jobPublished' as const, path: '/employer/oferty' },
  ]);

  it.each(cases)('$template / $locale', async ({ locale, template, path }) => {
    const built = buildDeliveryData(
      { template, locale, payload: { companyName: 'Acme', jobTitle: 'Magazynier' } },
      SITE,
      'Anna',
    );
    const { html, subject } = await renderEmail(template, built.locale, built.data as never);
    expect(html).toContain('Magazynier');
    expect(html).toContain(`${SITE}/${locale}${path}`);
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
  });
});
