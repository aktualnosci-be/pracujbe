import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import { EmailLayout, EmailText, emailFontStack, emailPalette } from '@/emails/_components';
import { EMAIL_TYPES } from '@/emails/copy';
import { renderNewsletterEmail } from '@/emails/newsletter';
import { renderEmail } from '@/emails/templates';
import { routing } from '@/i18n/routing';

/**
 * Kalka prototypu „Ludzie i praca” w mailach (#7): każdy kolor w wyrenderowanym HTML musi
 * pochodzić z `emailPalette` (kolory `materials/newsletter.html` → tokeny `--pp-*`).
 * Inny hex albo rgb() w stylu inline = kolor spoza palety (regresja do dawnego wyglądu
 * albo kolor wpisany w szablon na sztywno).
 */
const ALLOWED = new Set(Object.values(emailPalette).map((hex) => hex.toUpperCase()));

function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((part) => part.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

/** Wszystkie kolory ze stylów inline i atrybutów (`bgcolor`, `color`) wyrenderowanego maila. */
function collectColors(html: string): string[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const sources: string[] = [];
  for (const element of Array.from(document.querySelectorAll('*'))) {
    for (const name of ['style', 'bgcolor', 'color']) {
      const value = element.getAttribute(name);
      if (value) sources.push(value);
    }
  }
  const colors: string[] = [];
  for (const source of sources) {
    for (const match of source.matchAll(/#([0-9a-f]{3}|[0-9a-f]{6})\b/gi)) {
      const hex = match[1]!;
      const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
      colors.push(`#${full}`.toUpperCase());
    }
    for (const match of source.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/gi)) {
      colors.push(toHex(Number(match[1]), Number(match[2]), Number(match[3])));
    }
  }
  return colors;
}

function foreignColors(html: string): string[] {
  return [...new Set(collectColors(html).filter((color) => !ALLOWED.has(color)))];
}

/** Nadzbiór pól wszystkich typów maili — każdy szablon bierze swoje. */
const SAMPLE = {
  firstName: 'Anna',
  recipientName: 'Anna',
  name: 'Anna',
  candidateName: 'Jan Nowak',
  senderName: 'Acme Logistics',
  inviterName: 'Piotr',
  companyName: 'Acme Logistics',
  jobTitle: 'Operator CNC',
  salary: '17–20 € brutto / godz.',
  message: 'Zapraszamy na rozmowę.\nDo zobaczenia.',
  preview: 'Dzień dobry, czy termin jest aktualny?',
  description: 'Opis płatności',
  reason: 'Brak numeru VAT',
  status: 'interview',
  expiresAt: '2026-10-01T12:00:00Z',
  expiryDate: '2026-10-01',
  searchName: 'Magazyn Antwerpia',
  count: 2,
  jobs: [
    { title: 'Magazynier', companyName: 'Acme Logistics', city: 'Antwerpia', url: 'https://pracuj.be/pl/oferty-pracy/magazynier' },
    { title: 'Kierowca C+E', city: 'Gandawa', url: 'https://pracuj.be/pl/oferty-pracy/kierowca' },
  ],
  amount: '0 €',
  invoiceNumber: 'F-1',
  subject: 'Pytanie',
  caseNumber: 'DSA-0000-0000',
  accessCode: 'ABCD-EFGH',
  targetType: 'job',
  confirmationUrl: 'https://pracuj.be/a',
  dashboardUrl: 'https://pracuj.be/b',
  resetUrl: 'https://pracuj.be/c',
  loginUrl: 'https://pracuj.be/d',
  inviteUrl: 'https://pracuj.be/e',
  applicationUrl: 'https://pracuj.be/f',
  actionUrl: 'https://pracuj.be/g',
  messageUrl: 'https://pracuj.be/h',
  offerUrl: 'https://pracuj.be/i',
  jobUrl: 'https://pracuj.be/j',
  renewUrl: 'https://pracuj.be/k',
  downloadUrl: 'https://pracuj.be/l',
};

describe('paleta e-maili = prototyp „Ludzie i praca”', () => {
  it.each(routing.locales.flatMap((locale) => EMAIL_TYPES.map((type) => [type, locale] as const)))(
    '%s (%s) używa wyłącznie kolorów z palety prototypu',
    async (type, locale) => {
      const { html } = await renderEmail(type, locale, SAMPLE as never, {
        unsubscribeUrl: 'https://pracuj.be/pl/wypisz?t=x',
      });
      expect(collectColors(html).length).toBeGreaterThan(0);
      expect(foreignColors(html)).toEqual([]);
      // Bez webfontów: DM Sans z systemu odbiorcy, dalej Arial (newsletter.html).
      expect(html).toContain(emailFontStack.replace(/'/g, '&#x27;'));
      expect(html).not.toMatch(/@font-face|fonts\.googleapis|<link[^>]+stylesheet/i);
    },
  );

  it.each(routing.locales)('newsletter (%s) używa wyłącznie kolorów z palety prototypu', async (locale) => {
    const { html } = await renderNewsletterEmail(locale, [
      { locale, slug: 'operator-wozka', title: 'Operator wózka widłowego', city: 'Antwerpia', salary: '17–20 €', isDemo: false },
    ]);
    expect(foreignColors(html)).toEqual([]);
  });

  it('kontrola ujemna: kolor spoza palety (np. dawny granat #0F2A47) jest wykrywany', async () => {
    const html = await render(
      <EmailLayout locale="pl" preview="Podgląd" title="Temat">
        <EmailText>Treść</EmailText>
        <p style={{ color: '#0F2A47', backgroundColor: 'rgb(37, 99, 235)' }}>Obcy kolor</p>
      </EmailLayout>,
    );
    expect(foreignColors(html)).toEqual(['#0F2A47', '#2563EB']);
  });
});
