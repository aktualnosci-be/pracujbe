import { expect, test, type Route } from "@playwright/test";

/**
 * Fallback service workera przy braku sieci (public/offline.html). Sprawdzamy to, co widzi
 * użytkownik OFFLINE: komunikat o braku połączenia w 4 językach (z `lang` na fragmentach),
 * logo w nowej identyfikacji i akcję ponowienia ≥ 48 px z widocznym fokusem, przy 320 px.
 */
test.use({ viewport: { width: 320, height: 640 }, serviceWorkers: "allow" });

test("bez sieci nawigacja pokazuje wielojęzyczny ekran offline w nowej identyfikacji", async ({
  page,
  context,
}) => {
  await page.goto("/pl");
  // Rejestrujemy SW jawnie: test dotyczy zachowania fallbacku, nie momentu rejestracji.
  await page.evaluate(async () => {
    await navigator.serviceWorker.register("/sw.js");
    await navigator.serviceWorker.ready;
  });
  // Pierwsze załadowanie nie jest jeszcze kontrolowane przez SW — przeładuj pod jego kontrolą.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);

  // Sama emulacja `setOffline` nie obejmuje pewnie service workera: jego fetch czasem
  // przechodził i zamiast fallbacku ładowała się prawdziwa strona (flaky, #375). Brak sieci
  // wymuszamy więc też trasą, która zrywa każde żądanie jak odłączony internet.
  const offline = (route: Route) => route.abort("internetdisconnected");
  await context.route("**/*", offline);
  await context.setOffline(true);
  await page.goto("/nl/oferty-pracy").catch(() => undefined);

  const heading = page.getByRole("heading", { level: 1 });
  for (const locale of ["pl", "nl", "fr", "en"]) {
    await expect(heading.locator(`[lang="${locale}"]`)).toBeVisible();
  }
  await expect(page.getByRole("img", { name: "Pracuj.be", exact: true })).toBeVisible();

  const retry = page.getByRole("button");
  await expect(retry).toContainText("Spróbuj ponownie");
  await expect(retry.locator('[lang="en"]')).toHaveText("Try again");
  const box = await retry.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(48);

  await page.keyboard.press("Tab");
  await expect(retry).toBeFocused();
  const outline = await retry.evaluate((el) => getComputedStyle(el).outlineStyle);
  expect(outline).not.toBe("none");

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);

  // Po powrocie sieci ponowienie ładuje ŻĄDANY adres, a nie stronę główną.
  await context.setOffline(false);
  await context.unroute("**/*", offline);
  await retry.click();
  await expect(page).toHaveURL(/\/nl\/oferty-pracy$/);
  await expect(page.locator("html")).toHaveAttribute("lang", "nl");
});
