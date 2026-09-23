import { expect, test } from "@playwright/test";

import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import nl from "../../src/messages/nl.json";
import pl from "../../src/messages/pl.json";

const locales = { pl, nl, fr, en } as const;

test('klawiatura kieruje fokus na pierwszy błąd i odczytuje go przy polu', async ({ page }) => {
  await page.goto('/pl/employer/oferty/nowa');
  await page.getByRole('button', { name: pl.cookies.rejectOptional }).click();

  const next = page.getByRole('button', { name: pl.jobWizard.next, exact: true });
  const title = page.getByLabel(pl.jobWizard.titleLabel);
  const category = page.getByRole('combobox', { name: pl.jobWizard.categoryLabel });

  await next.focus();
  await page.keyboard.press('Enter');
  await expect(title).toBeFocused();
  await expect(title).toHaveAttribute('aria-invalid', 'true');
  await expect(title).toHaveAttribute('aria-describedby', 'job-title-error');
  await expect(page.locator('#job-title-error')).toHaveText(pl.job.error.titleRequired);

  await title.fill('Operator magazynu');
  await page.getByLabel(pl.jobWizard.occupationLabel).fill('Magazynier');
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(category).toBeFocused();
  await expect(category).toHaveAttribute('aria-invalid', 'true');
  await expect(category).toHaveAttribute('aria-describedby', 'job-category-error');
  await expect(page.locator('#job-category-error')).toHaveText(pl.job.error.categoryRequired);
});

for (const [locale, messages] of Object.entries(locales)) {
  test(`kreator oferty pokazuje lokalny postęp i czytelny formularz: ${locale}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 320, height: 800 });
    await page.goto(`/${locale}/employer/oferty/nowa`);

    const t = messages.jobWizard;
    await page
      .getByRole("button", { name: messages.cookies.rejectOptional })
      .click();
    await expect(
      page.getByRole("heading", { level: 1, name: t.title }),
    ).toBeVisible();
    const progress = t.stepProgress
      .replace("{current}", "1")
      .replace("{total}", "9");
    await expect(
      page.getByRole("navigation", { name: progress }),
    ).toBeVisible();
    await expect(page.getByLabel(t.titleLabel)).toBeVisible();
    await page.getByLabel(t.titleLabel).fill("Operator magazynu");
    await page.getByRole("button", { name: t.next, exact: true }).click();
    await expect(page.getByLabel(t.titleLabel)).toHaveValue(
      "Operator magazynu",
    );
    await expect(
      page.getByRole("heading", { level: 2, name: t.step1Title }),
    ).toBeVisible();

    await page.getByLabel(t.categoryLabel).click();
    await page.getByRole("option").first().click();
    await page.getByLabel(t.occupationLabel).fill("Magazynier");
    await page.getByRole("button", { name: t.next, exact: true }).click();
    await expect(
      page.getByRole("heading", { level: 2, name: t.step2Title }),
    ).toBeVisible();
    await page.getByRole("button", { name: t.back, exact: true }).click();
    await expect(page.getByLabel(t.titleLabel)).toHaveValue(
      "Operator magazynu",
    );

    const overflow = await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
  });
}
