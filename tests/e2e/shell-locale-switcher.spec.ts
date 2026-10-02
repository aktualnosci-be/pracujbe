import { expect, test } from "@playwright/test";
import { waitForHydrated } from "./fixtures/hydration";

const names = { pl: "Polski", nl: "Nederlands", fr: "Français", en: "English" } as const;

test("nazwy języków w przełączniku mają atrybut lang swojego języka", async ({ page }) => {
  await page.goto("/pl/oferty-pracy");
  const footer = page.getByRole("contentinfo");
  // Klawiaturą: baner cookies (fixed) może przykrywać stopkę przy pierwszej wizycie.
  // Enter otwiera listę dopiero po hydratacji (handler klawiatury z Reacta).
  await waitForHydrated(footer.getByRole("combobox"));
  await footer.getByRole("combobox").focus();
  await page.keyboard.press("Enter");

  for (const [locale, name] of Object.entries(names)) {
    const option = footer.getByRole("option", { name, exact: true });
    await expect(option.locator(`[lang="${locale}"]`)).toHaveText(name);
  }
  // Wartość w przycisku także jest oznaczona językiem.
  await expect(footer.getByRole("combobox").locator('[lang="pl"]')).toHaveText(names.pl);
});

test("po zmianie języka w stopce fokus wraca na przełącznik, nie na body", async ({ page }) => {
  await page.goto("/pl/oferty-pracy?q=kierowca");
  const combobox = page.getByRole("contentinfo").getByRole("combobox");
  await waitForHydrated(combobox);
  await combobox.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");

  await expect(page).toHaveURL(/\/en\/oferty-pracy\?q=kierowca$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
  await expect(page.getByRole("contentinfo").getByRole("combobox")).toBeFocused();
});

test.describe("menu mobilne", () => {
  test.use({ viewport: { width: 320, height: 640 } });

  test("po zmianie języka w panelu fokus trafia na przycisk menu", async ({ page }) => {
    await page.goto("/nl/oferty-pracy?q=chauffeur");
    // Panel menu otwiera się dopiero po hydratacji (handler `onClick` z Reacta).
    const menu = page.getByRole("button", { name: "Menu" });
    await waitForHydrated(menu);
    await menu.click();
    await page.getByRole("dialog").getByRole("combobox").focus();
    await page.keyboard.press("Enter");
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");

    await expect(page).toHaveURL(/\/pl\/oferty-pracy\?q=chauffeur$/);
    await expect(page.getByRole("button", { name: "Menu" })).toBeFocused();
  });
});
