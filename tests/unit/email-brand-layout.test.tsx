import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import {
  EmailButton,
  EmailHeading,
  EmailHighlight,
  EmailLayout,
  EmailQuote,
} from '@/emails/_components';
import { layoutCopy } from '@/emails/copy';
import { routing, type Locale } from '@/i18n/routing';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

describe('wspólny layout e-maili', () => {
  it('renderuje zatwierdzone logo i paletę marki w gotowym HTML wiadomości', async () => {
    const html = await render(
      <EmailLayout locale="pl" preview="Podgląd wiadomości">
        <EmailHeading>Nowa propozycja pracy</EmailHeading>
        <EmailHighlight>Operator produkcji</EmailHighlight>
        <EmailQuote>Treść wiadomości</EmailQuote>
        <EmailButton href="https://pracuj.be/pl/oferty-pracy/test">Zobacz ofertę</EmailButton>
      </EmailLayout>,
    );

    const document = new DOMParser().parseFromString(html, 'text/html');
    const homeLink = document.querySelector('a[href="http://localhost:3000/pl"]');
    // Logo jak w nagłówku strony / newsletter.html prototypu: dwie komórki tabeli (#7).
    const logoParts = homeLink?.querySelectorAll('td');
    const brandButton = document.querySelector(
      'a[href="https://pracuj.be/pl/oferty-pracy/test"]',
    ) as HTMLElement | null;
    const quote = Array.from(document.querySelectorAll('p')).find(
      (element) => element.textContent === 'Treść wiadomości',
    );

    expect(homeLink?.textContent).toBe('pracuj.be');
    expect(logoParts).toHaveLength(2);
    expect((logoParts?.[0] as HTMLElement).style.color).toBe('rgb(21, 21, 21)');
    expect((logoParts?.[1] as HTMLElement).style.backgroundColor).toBe('rgb(217, 41, 50)');
    expect((logoParts?.[1] as HTMLElement).style.color).toBe('rgb(255, 255, 255)');
    expect((logoParts?.[1] as HTMLElement).textContent).toBe('.be');
    expect(brandButton?.style.backgroundColor).toBe('rgb(217, 41, 50)');
    expect(brandButton?.getAttribute('href')).toBe(
      'https://pracuj.be/pl/oferty-pracy/test',
    );

    const readPixels = (value: string | undefined) =>
      value?.endsWith('px') ? Number.parseFloat(value) : Number.NaN;
    const lineHeight = readPixels(brandButton?.style.lineHeight);
    const paddingTop = readPixels(brandButton?.style.paddingTop);
    const paddingBottom = readPixels(brandButton?.style.paddingBottom);
    expect(lineHeight + paddingTop + paddingBottom).toBeGreaterThanOrEqual(48);

    expect((logoParts?.[1] as HTMLElement).style.borderRadius).toBe('6px');
    expect(brandButton?.style.borderRadius).toBe('11px');

    // Notatka jak `.p-profile-note` prototypu; tło wokół kolumny jak newsletter.html.
    expect(quote?.style.borderColor).toBe('rgb(240, 216, 217)');
    expect(quote?.style.backgroundColor).toBe('rgb(255, 249, 249)');
    expect(document.body.style.backgroundColor).toBe('rgb(244, 244, 244)');
  });

  it.each(routing.locales)(
    'prowadzi ze stopki do pomocy i polityki prywatności w języku odbiorcy (%s)',
    async (locale: Locale) => {
      const html = await render(
        <EmailLayout locale={locale} preview="Podgląd wiadomości">
          <EmailHeading>Wiadomość</EmailHeading>
        </EmailLayout>,
      );

      expect(footerProblems(html, locale)).toEqual([]);
      // Etykieta = „Pytania i odpowiedzi” ze stopki strony w tym samym języku.
      expect(layoutCopy[locale].help).toBe(MESSAGES[locale].footer.faq);
    },
  );

  it('kontrola ujemna: sprawdzenie stopki łapie zły język i brak linku pomocy albo prywatności', () => {
    const footer = (links: string): string =>
      `<html><body><a href="http://localhost:3000/pl">logo</a>${links}</body></html>`;
    const help = (locale: Locale) =>
      `<a data-email-help="" href="http://localhost:3000/${locale}/pomoc">${layoutCopy[locale].help}</a>`;
    const privacy = (locale: Locale) =>
      `<a data-email-privacy="" href="http://localhost:3000/${locale}/polityka-prywatnosci">${layoutCopy[locale].privacy}</a>`;

    expect(footerProblems(footer(help('nl') + privacy('nl')), 'nl')).toEqual([]);
    // Linki w języku nadawcy zamiast odbiorcy (Invariant #1).
    expect(footerProblems(footer(help('pl') + privacy('nl')), 'nl')).toContain('help-href');
    expect(footerProblems(footer(help('nl') + privacy('pl')), 'nl')).toContain('privacy-href');
    // Brak któregoś z linków.
    expect(footerProblems(footer(privacy('nl')), 'nl')).toContain('help-missing');
    expect(footerProblems(footer(help('nl')), 'nl')).toContain('privacy-missing');
  });
});

const MESSAGES = { pl, nl, fr, en } as const;

/** Problemy stopki: po jednym linku pomocy i polityki prywatności, oba w języku odbiorcy. */
function footerProblems(html: string, locale: Locale): string[] {
  const document = new DOMParser().parseFromString(html, 'text/html');
  const links = Array.from(document.querySelectorAll('a'));
  const problems: string[] = [];
  const check = (name: 'help' | 'privacy', path: string): void => {
    const found = links.filter((link) => link.hasAttribute(`data-email-${name}`));
    if (found.length !== 1) {
      problems.push(`${name}-missing`);
      return;
    }
    if (found[0]!.getAttribute('href') !== `http://localhost:3000/${locale}/${path}`) problems.push(`${name}-href`);
    if (found[0]!.textContent !== layoutCopy[locale][name]) problems.push(`${name}-label`);
  };
  check('help', 'pomoc');
  check('privacy', 'polityka-prywatnosci');
  return problems;
}
