import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

for (const locale of ["pl", "nl", "fr", "en"] as const) {
  test(`employer candidates passport fits 320 px in ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    const messages = JSON.parse(
      readFileSync(resolve("src/messages", `${locale}.json`), "utf8"),
    );
    await page.goto(`/${locale}/employer/kandydaci`);

    await expect(
      page.getByRole("heading", {
        level: 1,
        name: messages.dashboard.navCandidates,
      }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("listitem")
        .filter({ has: page.getByRole("progressbar") })
        .first(),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth),
    ).toBeLessThanOrEqual(320);
  });
}
