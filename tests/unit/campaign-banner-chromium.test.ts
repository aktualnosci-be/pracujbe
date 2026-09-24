import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BANNER_FORMATS, bannerSize, renderCampaignBanner } from '@/lib/campaign-banner/render';
import { measureText } from '@/lib/campaign-banner/text';
import { launchChromium } from '../../scripts/lib/launch-chromium.mjs';

/**
 * Baner kampanii (#175) w prawdziwym Chromium z osadzonym DM Sans: szerokość każdego tekstu
 * zmierzona przez przeglądarkę nie przekracza pomiaru serwera (tablica `metrics.generated.ts`),
 * więc skracanie „…” działa; każdy tekst leży w granicach grafiki, tekst przycisku w przycisku,
 * a teksty karty w karcie. Kontrola ujemna: pomiar zaniżony o 10% zostałby przez ten test wykryty.
 */

const FONT = readFileSync(resolve(process.cwd(), 'src/app/fonts/DMSans-latin.woff2')).toString('base64');

const CASES = [
  {
    job: { slug: 'operator-wozka-widlowego', title: 'Operator wózka widłowego wysokiego składowania — zmiana nocna, Antwerpia i okolice portu', companyName: 'Logistyka Noord Wereldwijd Transport en Opslag NV', city: 'Sint-Niklaas' },
    salary: '2 450,50–3 100,75 € brutto / mies.',
  },
  { job: { slug: 'kucharz', title: 'Kucharz', companyName: 'Bistro Ł', city: 'Liège' }, salary: null },
  { job: { slug: 'wwww', title: 'WWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWWW', companyName: 'MMMMMMMMMMMMMMMMMMMMMMMMMMMM', city: 'ŻŻŻŻŻŻŻŻŻŻŻŻŻŻŻŻŻŻ' }, salary: '17 € brutto / godz.' },
];

type Box = { text: string; size: number; weight: number; spacing: number; length: number; x: number; right: number; inButton: boolean; top: number; bottom: number };

let browser: Awaited<ReturnType<typeof launchChromium>>;

beforeAll(async () => {
  browser = await launchChromium();
}, 60_000);

afterAll(async () => {
  await browser?.close();
});

async function measure(svg: string): Promise<{ fontLoaded: boolean; boxes: Box[]; buttons: Array<{ x: number; right: number }>; cards: Array<{ x: number; right: number; top: number; bottom: number }> }> {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><body style="margin:0">${svg}</body>`);
    await page.evaluate(() => document.fonts.ready);
    return await page.evaluate(() => {
      const fontLoaded = document.fonts.check('700 16px PracujDMSans');
      const boxes = Array.from(document.querySelectorAll('text')).map((node) => {
        const box = node.getBBox();
        const ctm = node.getCTM();
        const offset = ctm ? ctm.e : 0;
        return {
          text: node.textContent ?? '',
          size: Number(node.getAttribute('font-size')),
          weight: Number(node.getAttribute('font-weight')),
          spacing: Number(node.getAttribute('letter-spacing') ?? 0),
          length: node.getComputedTextLength(),
          x: box.x + offset,
          right: box.x + box.width + offset,
          top: box.y,
          bottom: box.y + box.height,
          inButton: node.closest('a') !== null,
        };
      });
      const rects = Array.from(document.querySelectorAll('rect'));
      const buttons = rects.filter((r) => r.closest('a')).map((r) => ({ x: Number(r.getAttribute('x')), right: Number(r.getAttribute('x')) + Number(r.getAttribute('width')) }));
      const cards = rects
        .filter((r) => !r.closest('a') && !r.closest('g[aria-hidden]') && r.getAttribute('x'))
        .map((r) => ({ x: Number(r.getAttribute('x')), right: Number(r.getAttribute('x')) + Number(r.getAttribute('width')), top: Number(r.getAttribute('y')), bottom: Number(r.getAttribute('y')) + Number(r.getAttribute('height')) }));
      return { fontLoaded, boxes, buttons, cards };
    });
  } finally {
    await page.close();
  }
}

describe('baner kampanii w Chromium (osadzony DM Sans)', () => {
  for (const format of BANNER_FORMATS) {
    it(`${format}: teksty mieszczą się w polach i nie przekraczają pomiaru serwera`, async () => {
      const { width, height } = bannerSize(format);
      for (const { job, salary } of CASES) {
        const svg = renderCampaignBanner({
          format,
          locale: 'pl',
          job,
          texts: { eyebrow: 'Oferta pracy w Belgii', cta: 'Postuler maintenant', salary, conditions: 'Umowa na czas określony · Z zakwaterowaniem', accessibleName: job.title },
          fontWoff2Base64: FONT,
        });
        const { fontLoaded, boxes, buttons, cards } = await measure(svg);
        expect(fontLoaded).toBe(true);
        expect(boxes.length).toBeGreaterThanOrEqual(5);
        // Kontrola ujemna: gdyby tablica szerokości zaniżała o 10%, asercja niżej by padła.
        expect(
          boxes.some((b) => b.length > 0.9 * measureText(b.text, b.size, b.weight === 700 ? 700 : 400, b.spacing / b.size)),
        ).toBe(true);
        for (const box of boxes) {
          const estimate = measureText(box.text, box.size, box.weight === 700 ? 700 : 400, box.spacing / box.size);
          expect(box.length, `${format} „${box.text}”`).toBeLessThanOrEqual(estimate + 0.5);
          expect(box.x, box.text).toBeGreaterThanOrEqual(0);
          expect(box.right, box.text).toBeLessThanOrEqual(width - 16);
          expect(box.bottom, box.text).toBeLessThanOrEqual(height);
          if (box.inButton) {
            const button = buttons[0]!;
            expect(box.right, box.text).toBeLessThanOrEqual(button.right - 8);
          }
          const card = cards.find((c) => box.x >= c.x && box.top >= c.top && box.bottom <= c.bottom);
          if (card) expect(box.right, `karta: ${box.text}`).toBeLessThanOrEqual(card.right - 16);
        }
      }
    }, 60_000);
  }
});
