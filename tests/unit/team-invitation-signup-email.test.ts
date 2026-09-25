import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Locale } from '@/i18n/routing';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData } from '@/lib/email/delivery-data';
import { guestDeliveryToken } from '@/lib/email/guest-delivery';
import { hashTeamInviteToken, issueTeamInviteToken } from '@/lib/team/invite-token';

/**
 * 0124 — zaproszenie do zespołu dla adresu bez konta: e-mail w języku zaproszenia (kolumna
 * `locale`, wybranej przez zapraszającego), link do rejestracji pracodawcy z tokenem we
 * fragmencie `#` odtworzonym z nonce (w bazie tylko hash), bez nonce w treści.
 */

vi.mock('@/lib/env', () => ({ isProductionMode: vi.fn(() => false), env: { siteUrl: 'https://pracuj.be' } }));

const SITE = 'https://pracuj.be';
const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];

beforeEach(() => {
  process.env.GUEST_APPLY_SECRET = 'k'.repeat(40);
});

describe('teamInvitationSignup', () => {
  it.each(LOCALES)('%s: link rejestracji z tokenem we fragmencie, język z wiersza kolejki', async (locale) => {
    const issued = issueTeamInviteToken()!;
    const payload = { nonce: issued.nonce, companyName: 'Acme BV', inviterName: 'Olga Owner' };
    const token = guestDeliveryToken('teamInvitationSignup', payload)!;
    expect(hashTeamInviteToken(token)).toBe(issued.hash);

    const built = buildDeliveryData({ template: 'teamInvitationSignup', locale, payload }, SITE, undefined, token);
    const url = `${SITE}/${locale}/rejestracja-pracodawca#token=${token}`;
    expect(built.data).not.toHaveProperty('nonce');
    expect(built.data['actionUrl']).toBe(url);

    const { html, subject, text } = await renderEmail('teamInvitationSignup', built.locale, built.data as never);
    expect(html).toContain(url);
    expect(html).toContain('Acme BV');
    expect(html).toContain('Olga Owner');
    expect(html).not.toContain(issued.nonce);
    expect(`${subject}${html}${text}`).not.toMatch(/\{\w+\}/);
  });

  it('bez nazwy zapraszającego: neutralny wariant treści', async () => {
    const built = buildDeliveryData(
      { template: 'teamInvitationSignup', locale: 'nl', payload: { nonce: 'n'.repeat(32), companyName: 'Acme', inviterName: '' } },
      SITE, undefined, 't'.repeat(43),
    );
    const { html } = await renderEmail('teamInvitationSignup', built.locale, built.data as never);
    expect(html).toContain('Je bent uitgenodigd voor het team van Acme');
  });

  it('KONTROLA UJEMNA: token zaproszenia ≠ token aplikacji gościa dla tego samego nonce', () => {
    const payload = { nonce: 'n'.repeat(32) };
    const invite = guestDeliveryToken('teamInvitationSignup', payload);
    expect(invite).toBeTruthy();
    expect(invite).not.toBe(guestDeliveryToken('guestApplicationConfirm', payload));
    expect(invite).not.toBe(guestDeliveryToken('guestApplicationSent', payload));
  });

  it('brak tokenu → błąd wiersza (ponowienie), nie e-mail z martwym linkiem', () => {
    expect(guestDeliveryToken('teamInvitationSignup', { nonce: 'short' })).toBeNull();
    expect(() =>
      buildDeliveryData({ template: 'teamInvitationSignup', locale: 'pl', payload: {} }, SITE, undefined, null),
    ).toThrow('guest_token_unavailable');
  });

  it('zaproszenie konta z profilem bez zmian: panel zespołu, bez tokenu', () => {
    expect(guestDeliveryToken('teamInvitation', { nonce: 'n'.repeat(32) })).toBeUndefined();
    const built = buildDeliveryData({ template: 'teamInvitation', locale: 'fr', payload: { companyName: 'Acme' } }, SITE);
    expect(built.data['actionUrl']).toBe(`${SITE}/fr/employer/zespol`);
  });
});
