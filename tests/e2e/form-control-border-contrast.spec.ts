import { expect, test, type Page } from '@playwright/test';

// #218 — WCAG 1.4.11 Non-text Contrast: obramowanie pól formularzy
// (token --input) musi mieć co najmniej 3:1 względem tła, na którym leży.
// Mierzymy obliczony `border-color` kontrolki w stanie spoczynku i
// efektywne tło (pierwszy nieprzezroczysty przodek).

const CONTROLS = [
  'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
  'textarea',
  'select',
  'button[role="checkbox"]:not([data-state="checked"])',
  'button[role="combobox"]',
].join(', ');

const pages = [
  '/pl/rejestracja-pracodawca',
  '/pl/rejestracja',
  '/pl/logowanie',
  '/pl/oferty-pracy',
  '/pl/candidate/onboarding',
  '/pl/employer/oferty/nowa',
  '/pl/employer/firma',
];

type Measured = { control: string; border: string; background: string; ratio: number };

async function measureControls(page: Page): Promise<Measured[]> {
  return page.evaluate((selector) => {
    const parse = (value: string): [number, number, number, number] => {
      const m = value.match(/rgba?\(([^)]+)\)/);
      if (!m) return [0, 0, 0, 0];
      const parts = m[1]!.split(/[ ,/]+/).filter(Boolean).map(Number);
      return [parts[0]!, parts[1]!, parts[2]!, parts[3] ?? 1];
    };
    const luminance = ([r, g, b]: number[]) => {
      const lin = (c: number) => {
        const s = c / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(b!);
    };
    const effectiveBackground = (el: Element | null): number[] => {
      for (let node = el; node; node = node.parentElement) {
        const bg = parse(getComputedStyle(node).backgroundColor);
        if (bg[3] >= 1) return bg;
      }
      return [255, 255, 255, 1];
    };
    return Array.from(document.querySelectorAll<HTMLElement>(selector))
      .filter((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return (
          rect.width > 0 &&
          rect.height > 0 &&
          style.visibility !== 'hidden' &&
          parseFloat(style.borderTopWidth) > 0 &&
          style.borderTopStyle !== 'none'
        );
      })
      .map((el) => {
        const border = parse(getComputedStyle(el).borderTopColor);
        // Obramowanie leży na tle rodzica (tło kontrolki jest wewnątrz ramki).
        const background = effectiveBackground(el.parentElement);
        const l1 = luminance(border);
        const l2 = luminance(background);
        const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
        return {
          control: `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''}${el.getAttribute('name') ? `[name=${el.getAttribute('name')}]` : ''}${el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : ''}`,
          border: getComputedStyle(el).borderTopColor,
          background: `rgb(${background.slice(0, 3).join(', ')})`,
          ratio: Math.round(ratio * 100) / 100,
        };
      });
  }, CONTROLS);
}

for (const path of pages) {
  test(`obramowanie pól formularza ma kontrast ≥ 3:1: ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.getByRole('main')).toBeVisible();
    const measured = await measureControls(page);
    expect(measured.length, `${path}: brak kontrolek do zmierzenia`).toBeGreaterThan(0);
    const failing = measured.filter((m) => m.ratio < 3);
    expect(failing, `${path}: obramowanie kontrolek poniżej 3:1`).toEqual([]);
  });
}

test('rejestracja pracodawcy: input i checkbox zgody mają obramowanie ≥ 3:1', async ({ page }) => {
  await page.goto('/pl/rejestracja-pracodawca');
  const measured = await measureControls(page);
  const input = measured.find((m) => m.control.startsWith('input'));
  const checkbox = measured.find((m) => m.control.includes('[role=checkbox]'));
  expect(input, 'pole tekstowe').toBeDefined();
  expect(checkbox, 'checkbox zgody').toBeDefined();
  expect(input!.ratio).toBeGreaterThanOrEqual(3);
  expect(checkbox!.ratio).toBeGreaterThanOrEqual(3);
});
