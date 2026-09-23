import { expect, test } from '@playwright/test';

/**
 * WCAG 1.4.11 (#214): przełączniki kategorii w centrum zgód muszą być widoczne w stanie „wył.”
 * — obrys lub tor kontrolki ma kontrast ≥ 3:1 z tłem dialogu.
 */

for (const locale of ['pl', 'nl', 'fr', 'en'] as const) {
  test(`wyłączony przełącznik cookies ma kontrast ≥ 3:1 (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}`);
    const banner = page.locator('[aria-labelledby="cookie-banner-title"]');
    // Drugi przycisk banera otwiera centrum ustawień (kolejność: odrzuć · dostosuj · akceptuj).
    await banner.getByRole('button').nth(1).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();

    const switches = dialog.locator('[role="switch"][aria-checked="false"]');
    await expect(switches).toHaveCount(3);

    const ratios = await switches.evaluateAll((elements) => {
      type Rgba = [number, number, number, number];
      const parse = (value: string): Rgba => {
        const m = value.match(/rgba?\(([^)]+)\)/);
        if (!m) return [0, 0, 0, 0];
        const [r, g, b, a = '1'] = m[1].split(/[\s,/]+/).filter(Boolean);
        return [Number(r), Number(g), Number(b), Number(a)];
      };
      const over = (top: Rgba, bottom: Rgba): Rgba => {
        const a = top[3];
        return [0, 1, 2].map((i) => top[i] * a + bottom[i] * (1 - a)).concat(1) as Rgba;
      };
      const lum = ([r, g, b]: Rgba) => {
        const c = [r, g, b].map((v) => {
          const s = v / 255;
          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        });
        return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
      };
      const contrast = (x: Rgba, y: Rgba) => {
        const [hi, lo] = [lum(x), lum(y)].sort((p, q) => q - p);
        return (hi + 0.05) / (lo + 0.05);
      };
      return elements.map((el) => {
        const dialog = el.closest('[role="dialog"]')!;
        const bg = over(parse(getComputedStyle(dialog).backgroundColor), [255, 255, 255, 1]);
        const style = getComputedStyle(el);
        const border = over(parse(style.borderTopColor), bg);
        const track = over(parse(style.backgroundColor), bg);
        const borderWidth = parseFloat(style.borderTopWidth);
        return Math.max(borderWidth > 0 ? contrast(border, bg) : 1, contrast(track, bg));
      });
    });
    for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(3);
  });
}
