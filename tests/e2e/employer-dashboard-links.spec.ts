import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { expect, test } from "@playwright/test";

for (const locale of ["pl", "nl", "fr", "en"] as const) {
  test(`employer dashboard keeps application and candidate destinations separate in ${locale}`, async ({
    page,
  }) => {
    const messages = JSON.parse(
      readFileSync(resolve("src/messages", `${locale}.json`), "utf8"),
    );
    await page.goto(`/${locale}/employer`);

    const applications = page.locator("main section").filter({
      has: page.getByRole("heading", {
        name: messages.dashboard.recentApplications,
      }),
    });
    const candidates = page.locator("main section").filter({
      has: page.getByRole("heading", { name: messages.dashboard.topMatched }),
    });

    await expect(
      applications.getByRole("link", {
        name: messages.dashboard.seeAll,
        exact: true,
      }),
    ).toHaveAttribute("href", `/${locale}/employer/aplikacje`);
    await expect(
      candidates.getByRole("link", {
        name: messages.dashboard.seeAllCandidates,
        exact: true,
      }),
    ).toHaveAttribute("href", `/${locale}/employer/kandydaci`);
  });
}
