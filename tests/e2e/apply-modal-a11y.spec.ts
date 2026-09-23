import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "@playwright/test";

/**
 * Regresja #209: dostępność dialogu „Aplikuj teraz”.
 * - pole kierunkowego i pole numeru mają różne nazwy dostępne,
 * - wymagane pola są oznaczone programowo (aria-required), a gwiazdka nie jest czytana,
 * - po błędzie z serwera fokus trafia na komunikat błędu (nie na kontener dialogu).
 * Tryb demo nie ma bazy, więc wysyłka zawsze kończy się błędem — to stabilny scenariusz błędu.
 */

const locales = ["pl", "nl", "fr", "en"] as const;
type Locale = (typeof locales)[number];
type Apply = { phone: string; dialCode: string; submit: string; consent: string };
const DEMO_JOB_SLUG = "bricklayer-brussels-1002";

function msgs(locale: Locale): { apply: Apply; jobs: { applyNow: string } } {
  return JSON.parse(
    readFileSync(resolve(process.cwd(), "src", "messages", `${locale}.json`), "utf-8"),
  );
}

for (const locale of locales) {
  test(`dialog aplikowania: nazwy, wymagane pola i fokus po błędzie (${locale})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/${locale}/oferty-pracy/${DEMO_JOB_SLUG}`);
    const t = msgs(locale);

    await page.getByRole("button", { name: t.jobs.applyNow }).first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    const dial = dialog.getByRole("combobox", { name: t.apply.dialCode, exact: true });
    await expect(dial).toBeVisible();
    const phone = dialog.getByRole("textbox", { name: t.apply.phone, exact: true });
    await expect(phone).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: t.apply.phone, exact: true })).toHaveCount(0);

    await expect(phone).toHaveAttribute("aria-required", "true");
    const consent = dialog.getByRole("checkbox", { name: t.apply.consent });
    await expect(consent).toHaveAttribute("aria-required", "true");

    await phone.fill("470123456");
    await consent.click();
    await dialog.getByRole("button", { name: t.apply.submit }).click();

    const alert = dialog.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).toBeFocused();
  });
}
