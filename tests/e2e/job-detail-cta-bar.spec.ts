import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";

/**
 * Regresja #202: mobilny pasek CTA szczegółu oferty.
 * - CTA „Aplikuj” mieści się w całości w 320 px we wszystkich językach (FR było obcięte),
 * - pasek ma jeden wiersz (nie rośnie od długiego opisu stanu zapisu),
 * - element z fokusem nigdy nie chowa się pod paskiem, a koniec stopki nie jest przykryty.
 */

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];
const DEMO_JOB_SLUG = "bricklayer-brussels-1002";

function messages(locale: Locale): { jobs: { applyNow: string } } {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "src", "messages", `${locale}.json`), "utf-8"),
  );
}

async function setNecessaryConsent(context: BrowserContext): Promise<void> {
  await context.addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0",
        categories: { necessary: true, preferences: false, analytics: false },
        ts: "2026-01-01T00:00:00.000Z",
        id: "job-detail-cta-bar-e2e",
      }),
      url: "http://localhost:3000",
      sameSite: "Lax",
    },
  ]);
}

test.beforeEach(async ({ context }) => {
  await setNecessaryConsent(context);
});

async function barTop(page: Page): Promise<number> {
  return page
    .getByTestId("job-mobile-cta-bar")
    .evaluate((bar) => bar.getBoundingClientRect().top);
}

for (const locale of locales) {
  test(`pasek CTA mieści się w 320 px w jednym wierszu: ${locale}`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 640 });
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);

    const bar = page.getByTestId("job-mobile-cta-bar");
    await expect(bar).toBeVisible();
    const barBox = await bar.boundingBox();
    expect(barBox, "pasek").not.toBeNull();
    expect(barBox!.height).toBeLessThanOrEqual(80);

    const apply = bar.getByRole("button", { name: messages(locale).jobs.applyNow });
    const applyBox = await apply.boundingBox();
    expect(applyBox).not.toBeNull();
    expect(applyBox!.x).toBeGreaterThanOrEqual(0);
    expect(applyBox!.x + applyBox!.width).toBeLessThanOrEqual(320);
    expect(applyBox!.height).toBeGreaterThanOrEqual(48);
    // Etykieta CTA nie jest obcięta wewnątrz przycisku.
    const clipped = await apply.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped).toBe(false);

    const save = bar.locator("a, button").first();
    await expect(save).not.toHaveAccessibleName("");
    const saveBox = await save.boundingBox();
    expect(saveBox!.width).toBeGreaterThanOrEqual(48);
    expect(saveBox!.height).toBeGreaterThanOrEqual(48);
  });
}

test("fokus klawiatury i koniec strony nie chowają się pod paskiem CTA (375 px)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await page.goto(`/pl/oferty-pracy/${DEMO_JOB_SLUG}`);
  await expect(page.getByTestId("job-mobile-cta-bar")).toBeVisible();

  const obscured: string[] = [];
  for (let i = 0; i < 70; i += 1) {
    await page.keyboard.press("Tab");
    const hit = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      const bar = document.querySelector('[data-testid="job-mobile-cta-bar"]');
      if (!el || el === document.body || !bar || bar.contains(el)) return null;
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return null;
      const top = bar.getBoundingClientRect().top;
      return r.bottom > top + 1
        ? `${el.tagName}[${(el.textContent ?? "").trim().slice(0, 30)}] bottom=${Math.round(r.bottom)} barTop=${Math.round(top)}`
        : null;
    });
    if (hit) obscured.push(hit);
  }
  expect(obscured, obscured.join("\n")).toEqual([]);

  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const top = await barTop(page);
  const footerBottom = await page
    .locator("footer")
    .last()
    .evaluate((footer) => {
      const items = [...footer.querySelectorAll<HTMLElement>("a, button, p")].filter(
        (el) => el.getClientRects().length > 0,
      );
      return Math.max(...items.map((el) => el.getBoundingClientRect().bottom));
    });
  expect(footerBottom).toBeLessThanOrEqual(top + 1);
});
