import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "@playwright/test";

/**
 * Regresja #145 (serwer fixture `playwright.applications-fixture.config.ts`: oferty fikcyjne
 * z formularzem aplikowania, bez bazy — od #297 zwykły tryb demo pokazuje komunikat zamiast
 * formularza):
 * - niepoprawny numer telefonu zwraca błąd przy polu (komunikat, aria-invalid, fokus),
 *   a nie ogólny alert „Spróbuj ponownie”,
 * - poprawny numer w demo (syntetyczny jobId „1002”) daje jasny komunikat o trybie demo.
 */

const DEMO_JOB_PATH = "/pl/oferty-pracy/bricklayer-brussels-1002";

const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), "src", "messages", "pl.json"), "utf-8"),
) as { apply: Record<string, string>; jobs: { applyNow: string } };

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies([
    {
      name: "pracujbe_consent",
      value: JSON.stringify({
        v: process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0",
        categories: { necessary: true, preferences: false, analytics: false },
        ts: "2026-01-01T00:00:00.000Z",
        id: "apply-phone-validation-e2e",
      }),
      url: baseURL!,
      sameSite: "Lax",
    },
  ]);
});

async function openAndSubmit(page: import("@playwright/test").Page, phone: string) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(DEMO_JOB_PATH);
  await page.getByRole("button", { name: pl.jobs.applyNow }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#apply-phone").fill(phone);
  await dialog.getByRole("checkbox").check();
  await dialog.getByRole("button", { name: pl.apply.submit }).click();
  return dialog;
}

test("błędny numer telefonu: komunikat przy polu i fokus", async ({ page }) => {
  const dialog = await openAndSubmit(page, "abc");
  const phone = dialog.locator("#apply-phone");

  await expect(dialog.locator("#apply-phone-error")).toHaveText(pl.apply.phoneInvalid);
  await expect(phone).toHaveAttribute("aria-invalid", "true");
  await expect(phone).toBeFocused();
  await expect(dialog.getByText(pl.apply.errorGeneric)).toHaveCount(0);
});

test("poprawny numer w demo: komunikat o trybie demonstracyjnym", async ({ page }) => {
  const dialog = await openAndSubmit(page, "+32 470 12 34 56");

  await expect(dialog.getByRole("alert")).toHaveText(pl.apply.demoUnavailable);
  await expect(dialog.locator("#apply-phone")).not.toHaveAttribute("aria-invalid", "true");
});
