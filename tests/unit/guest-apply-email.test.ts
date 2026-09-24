import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { guestDeliveryToken } from '@/lib/email/guest-delivery';
import { hashGuestToken, issueGuestToken } from '@/lib/guest-apply/token';

/**
 * #98 — e-maile do gościa: link z tokenem odtworzonym z nonce (w bazie tylko hash), w języku
 * formularza gościa (kolumna `locale`), bez nonce w danych szablonu. Bez tokenu worker nie
 * wysyła maila z martwym linkiem (błąd → ponowienie).
 */

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false), env: { siteUrl: 'https://pracuj.be' } }));

const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

beforeEach(() => {
  process.env.GUEST_APPLY_SECRET = 'k'.repeat(40);
});

describe('guest emails', () => {
  it.each(LOCALES.flatMap((locale) => [
    { locale, template: 'guestApplicationConfirm' as const, purpose: 'confirm' as const, path: '/aplikacja/potwierdz' },
    { locale, template: 'guestApplicationSent' as const, purpose: 'claim' as const, path: '/aplikacja/przejmij' },
  ]))('$template / $locale', async ({ locale, template, purpose, path }) => {
    const issued = issueGuestToken(purpose)!;
    const payload = { nonce: issued.nonce, recipientName: 'Anna', jobTitle: 'Magazynier', companyName: 'Acme' };
    const token = guestDeliveryToken(template, payload)!;
    expect(hashGuestToken(token)).toBe(issued.hash);

    const built = buildDeliveryData({ template, locale, payload }, SITE, undefined, token);
    expect(built.data).not.toHaveProperty('nonce');
    expect(built.data['actionUrl']).toBe(`${SITE}/${locale}${path}#token=${token}`);

    const { html, subject } = await renderEmail(template, built.locale, built.data as never);
    expect(html).toContain(`${SITE}/${locale}${path}#token=${token}`);
    expect(html).toContain('Magazynier');
    expect(html).toContain('Acme');
    expect(html).not.toContain(issued.nonce);
    expect(subject).not.toMatch(/\{\w+\}/);
    expect(html).not.toMatch(/\{\w+\}/);
  });

  it('confirmation and claim tokens differ for the same nonce', () => {
    const payload = { nonce: 'n'.repeat(32) };
    expect(guestDeliveryToken('guestApplicationConfirm', payload)).not.toBe(
      guestDeliveryToken('guestApplicationSent', payload),
    );
  });

  it('missing token for a guest template throws (worker retries) instead of sending a dead link', () => {
    expect(() =>
      buildDeliveryData({ template: 'guestApplicationConfirm', locale: 'pl', payload: {} }, SITE, undefined, null),
    ).toThrow('guest_token_unavailable');
    expect(guestDeliveryToken('guestApplicationConfirm', { nonce: 'short' })).toBeNull();
  });

  it('other templates are unchanged (no token, no query)', () => {
    expect(guestDeliveryToken('newApplication', { nonce: 'n'.repeat(32) })).toBeUndefined();
    const built = buildDeliveryData({ template: 'newApplication', locale: 'fr', payload: { candidateName: 'Anna', jobTitle: 'X' } }, SITE);
    expect(built.data['actionUrl']).toBe(`${SITE}/fr/employer/aplikacje`);
  });
});
