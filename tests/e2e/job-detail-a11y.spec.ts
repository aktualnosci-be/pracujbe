import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

/**
 * Regresja #204: szczegół oferty objęty bramką axe (WCAG 2.x A/AA, critical/serious)
 * we wszystkich językach. Wcześniej sekcja „Zakwaterowanie i dojazd” miała dt/dd
 * zagnieżdżone za głęboko w `dl` (definition-list / dlitem, serious).
 */

const locales = ["pl", "nl", "fr", "en"] as const;
const WCAG_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const BLOCKING = new Set(["critical", "serious"]);
const DEMO_JOB_SLUG = "bricklayer-brussels-1002";

for (const locale of locales) {
  test(`a11y: szczegół oferty bez naruszeń critical/serious (${locale})`, async ({ page }) => {
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
    await page.getByRole("main").first().waitFor();
    await page.waitForTimeout(1000);

    const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
    const blocking = results.violations.filter((v) => BLOCKING.has(v.impact ?? ""));
    const summary = blocking
      .map((v) => `- [${v.impact}] ${v.id} (${v.nodes.length}×): ${v.nodes[0]?.target.join(" ")}`)
      .join("\n");
    expect(blocking, summary).toEqual([]);
  });
}

test("sekcja zakwaterowania to poprawna lista definicji (pary dt/dd)", async ({ page }) => {
  await page.goto(`/pl/oferty-pracy/${DEMO_JOB_SLUG}`);
  const pairs = await page.evaluate(() =>
    [...document.querySelectorAll("dl")].flatMap((dl) =>
      [...dl.querySelectorAll("dt, dd")].map((el) => {
        const parent = el.parentElement;
        return parent === dl || (parent?.tagName === "DIV" && parent.parentElement === dl);
      }),
    ),
  );
  expect(pairs.length).toBeGreaterThan(0);
  expect(pairs.every(Boolean)).toBe(true);
});
