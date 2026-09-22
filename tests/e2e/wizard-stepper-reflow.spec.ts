import { expect, test } from "@playwright/test";

const locales = {
  pl: { candidate: "Krok 1 z 6", employer: "Krok 1 z 9" },
  nl: { candidate: "Stap 1 van 6", employer: "Stap 1 van 9" },
  fr: { candidate: "Étape 1 sur 6", employer: "Étape 1 sur 9" },
  en: { candidate: "Step 1 of 6", employer: "Step 1 of 9" },
} as const;

for (const [locale, progress] of Object.entries(locales)) {
  for (const [kind, route, label] of [
    ["candidate", "candidate/onboarding", progress.candidate],
    ["employer", "employer/oferty/nowa", progress.employer],
  ]) {
    test(`${locale}: ${kind} pokazuje aktywny krok i mieści się przy 320 px oraz 200%`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: 320, height: 800 });
      await page.goto(`/${locale}/${route}`);

      const stepper = page.getByRole("navigation", { name: label });
      await expect(stepper).toBeVisible();
      await expect(stepper.locator('[aria-current="step"]')).toHaveCount(1);
      await expect(stepper.getByRole("listitem")).toHaveCount(
        kind === "candidate" ? 6 : 9,
      );

      for (const width of [320, 640]) {
        await page.setViewportSize({ width, height: 800 });
        await expect
          .poll(() =>
            page.evaluate(
              () =>
                document.documentElement.scrollWidth -
                document.documentElement.clientWidth,
            ),
          )
          .toBeLessThanOrEqual(1);
      }
    });
  }
}
