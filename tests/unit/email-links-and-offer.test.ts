import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { Locale } from '@/i18n/routing';
import type { EmailType } from '@/emails/copy';
import { renderEmail } from '@/emails/templates';
import { buildDeliveryData, emailTargetPath } from '@/lib/email/delivery-data';

/**
 * #290 — CTA w e-mailach prowadzi do właściwej sekcji panelu, w locale ODBIORCY.
 * #293 — e-mail propozycji pokazuje wiadomość pracodawcy i termin odpowiedzi.
 */

const LOCALES: readonly Locale[] = ['pl', 'nl', 'fr', 'en'];
const SITE = 'https://pracuj.be';
const CONVERSATION = '6f1c2a4e-1b2c-4d5e-8f90-123456789abc';

const QUEUED: Array<{ template: EmailType; payload: Record<string, unknown>; path: string }> = [
  { template: 'jobOffer', payload: { companyName: 'Acme', jobTitle: 'Magazynier' }, path: '/candidate/propozycje' },
  {
    template: 'statusChanged',
    payload: { companyName: 'Acme', jobTitle: 'Magazynier', status: 'viewed' },
    path: '/candidate/aplikacje',
  },
  { template: 'newApplication', payload: { candidateName: 'Jan', jobTitle: 'Magazynier' }, path: '/employer/aplikacje' },
  { template: 'offerAccepted', payload: { candidateName: 'Jan', jobTitle: 'Magazynier' }, path: '/employer/aplikacje' },
  { template: 'offerDeclined', payload: { candidateName: 'Jan', jobTitle: 'Magazynier' }, path: '/employer/kandydaci' },
  {
    template: 'newMessage',
    payload: { senderName: 'Jan', panel: 'employer', conversationId: CONVERSATION },
    path: `/employer/wiadomosci?c=${CONVERSATION}`,
  },
  { template: 'newMessage', payload: { senderName: 'Jan', panel: 'candidate' }, path: '/candidate/wiadomosci' },
];

/** Trasa istnieje jako strona App Routera `src/app/[locale]/…/page.tsx`. */
function routeExists(path: string): boolean {
  const pathname = path.split('?')[0]!;
  return existsSync(resolve(__dirname, '../../src/app/[locale]', `.${pathname}`, 'page.tsx'));
}

function hrefs(html: string): string[] {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return [...doc.querySelectorAll('a[href]')].map((a) => a.getAttribute('href') ?? '');
}

describe('#290: linki CTA w e-mailach z kolejki', () => {
  const cases = LOCALES.flatMap((locale) => QUEUED.map((q) => ({ locale, ...q })));

  it.each(cases)('$template ($path) / $locale', async ({ locale, template, payload, path }) => {
    expect(routeExists(path)).toBe(true);
    expect(emailTargetPath(template, payload)).toBe(path);

    const built = buildDeliveryData({ template, locale, payload }, SITE);
    expect(built.locale).toBe(locale);
    const { html } = await renderEmail(template, built.locale, built.data as never);
    const expected = `${SITE}/${locale}${path}`;
    const links = hrefs(html);
    // Przycisk i link zapasowy prowadzą do sekcji w locale odbiorcy, nie na ogólny pulpit.
    expect(links.filter((h) => h === expected).length).toBeGreaterThanOrEqual(2);
    expect(links).not.toContain(`${SITE}/${locale}/candidate`);
    expect(links).not.toContain(`${SITE}/${locale}/employer`);
  });

  it('ignoruje niepoprawny identyfikator rozmowy', () => {
    expect(emailTargetPath('newMessage', { conversationId: 'x"><script>' })).toBe('/candidate/wiadomosci');
  });

  it('nieobsługiwany locale w wierszu → en (fallback INVARIANTU #1)', () => {
    expect(buildDeliveryData({ template: 'jobOffer', locale: 'de', payload: {} }, SITE).data.offerUrl).toBe(
      `${SITE}/en/candidate/propozycje`,
    );
  });

  it('dokłada imię odbiorcy, ale nie nadpisuje danych z payloadu', () => {
    expect(buildDeliveryData({ template: 'jobOffer', locale: 'pl', payload: {} }, SITE, ' Anna ').data.firstName).toBe(
      'Anna',
    );
    expect(
      buildDeliveryData({ template: 'jobOffer', locale: 'pl', payload: { firstName: 'Ola' } }, SITE, 'Anna').data
        .firstName,
    ).toBe('Ola');
  });
});

describe('#293: e-mail propozycji — wiadomość i termin', () => {
  const expiry = {
    pl: ['Odpowiedz do', '31 października 2026'],
    nl: ['Reageer vóór', '31 oktober 2026'],
    fr: ['Répondre avant le', '31 octobre 2026'],
    en: ['Respond by', '31 October 2026'],
  } as const;

  it.each(LOCALES)('%s: cytat od pracodawcy + termin w formacie locale', async (locale) => {
    const { html } = await renderEmail('jobOffer', locale, {
      companyName: 'Acme',
      jobTitle: 'Magazynier',
      message: 'Zapraszamy od poniedziałku.',
      expiresAt: '2026-10-31T12:00:00Z',
      offerUrl: `${SITE}/${locale}/candidate/propozycje`,
    });
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const row = doc.querySelector('[data-passport-field="expires-at"]');
    expect(row?.textContent).toContain(expiry[locale][0]);
    expect(row?.textContent).toContain(expiry[locale][1]);
    expect(doc.body.textContent).toContain('Zapraszamy od poniedziałku.');
  });

  it.each(LOCALES)('%s: brak / zła data → bez wiersza terminu', async (locale) => {
    for (const expiresAt of [undefined, null, 'not-a-date']) {
      const { html } = await renderEmail('jobOffer', locale, {
        companyName: 'Acme',
        jobTitle: 'Magazynier',
        expiresAt,
        offerUrl: `${SITE}/${locale}/candidate/propozycje`,
      });
      expect(html).not.toContain('data-passport-field="expires-at"');
    }
  });
});
