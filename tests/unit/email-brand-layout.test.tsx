import { render } from '@react-email/render';
import { describe, expect, it } from 'vitest';

import {
  EmailButton,
  EmailHeading,
  EmailHighlight,
  EmailLayout,
  EmailQuote,
} from '@/emails/_components';

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
    const logoParts = homeLink?.querySelectorAll('span');
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

    expect(quote?.style.borderLeftColor).toBe('rgb(217, 41, 50)');
    expect(document.body.style.backgroundColor).toBe('rgb(247, 247, 247)');
  });
});
