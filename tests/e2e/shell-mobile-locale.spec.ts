import { expect, test } from "@playwright/test";

/**
 * Menu mobilne: każdy język musi być osiągalny DOTYKIEM. Lista opcji nie może wychodzić
 * poza ekran (wcześniej otwierała się w dół pod przełącznikiem przy dolnej krawędzi panelu).
 */
const viewports = [
  { width: 320, height: 640 },
  { width: 390, height: 844 },
] as const;

for (const viewport of viewports) {
  test.describe(`${viewport.width}×${viewport.height}`, () => {
    test.use({ viewport, hasTouch: true, isMobile: true });

    test("wszystkie opcje języka mieszczą się na ekranie, a tap zmienia język z zachowaniem query", async ({
      page,
    }) => {
      await page.goto("/pl/oferty-pracy?q=kierowca");
      await page.getByRole("button", { name: "Menu" }).tap();
      const dialog = page.getByRole("dialog");
      const trigger = dialog.getByRole("combobox");
      await trigger.tap();

      const options = dialog.getByRole("option");
      await expect(options).toHaveCount(4);
      // Lista otwiera się NAD przyciskiem (side="top"), a nie tylko mieści się dzięki przewijaniu panelu.
      const triggerBox = await trigger.boundingBox();
      const listBox = await dialog.getByRole("listbox").boundingBox();
      expect(triggerBox, "przycisk ma wymiary").not.toBeNull();
      expect(listBox, "lista ma wymiary").not.toBeNull();
      expect(listBox!.y + listBox!.height).toBeLessThanOrEqual(triggerBox!.y);
      for (const option of await options.all()) {
        const box = await option.boundingBox();
        expect(box, "opcja ma wymiary").not.toBeNull();
        expect(box!.y).toBeGreaterThanOrEqual(0);
        expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
      }

      await dialog.getByRole("option", { name: "English" }).tap();
      await expect(page).toHaveURL(/\/en\/oferty-pracy\?q=kierowca$/);
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    });
  });
}
