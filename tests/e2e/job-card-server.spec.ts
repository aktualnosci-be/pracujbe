import { readFileSync } from "fs";
import { resolve } from "path";
import { expect, test } from "@playwright/test";

const pl = JSON.parse(
  readFileSync(resolve(process.cwd(), "src", "messages", "pl.json"), "utf-8"),
) as { jobs: { saveLoading: string } };

/**
 * Regresja #391: karta oferty jest komponentem serwerowym. Payload RSC listy nie niesie
 * obiektów `JobListItem` (propsy klienckiej karty), a względna data powstaje na serwerze
 * (bez ostrzeżeń hydratacji) i ma pełną datę w `title`.
 */

function flightPayload(html: string): string {
  return [...html.matchAll(/self\.__next_f\.push\(\[1,(".*?")\]\)<\/script>/gs)]
    .map((match) => JSON.parse(match[1]) as string)
    .join("");
}

for (const path of ["/pl", "/pl/oferty-pracy"]) {
  test(`${path}: payload RSC bez propsów kart ofert`, async ({ request }) => {
    const html = await (await request.get(path)).text();
    const flight = flightPayload(html);
    expect(flight.length).toBeGreaterThan(0);
    expect(html).toContain('href="/pl/oferty-pracy/');
    // Pola JobListItem, których nie ma w słownikach tłumaczeń — występowały tylko w propsach
    // klienckiej karty (na main: jeden obiekt na kartę).
    for (const key of ['"companyVerified":', '"highlights":', '"salaryPeriod":', '"isNew":']) {
      expect(flight, key).not.toContain(key);
    }
  });
}

test("lista ofert: brak ostrzeżeń hydratacji, data z pełnym opisem, wyspa zapisu hydratowana", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (message) => {
    if (/hydrat|did not match/i.test(message.text())) problems.push(message.text());
  });
  page.on("pageerror", (error) => problems.push(error.message));
  await page.goto("/pl/oferty-pracy");
  const card = page.locator("article").filter({ has: page.locator("time") }).first();
  const time = card.locator("time");
  await expect(time).toHaveAttribute("datetime", /\d{4}-\d{2}-\d{2}/);
  await expect(time).toHaveAttribute("title", /\S/);
  await expect(time).not.toHaveText("");
  // Wyspa zapisu (jedyny element kliencki karty) hydratuje się i kończy wczytywanie stanu.
  const save = card.locator("header").locator("a, button").first();
  await expect(save).toBeVisible();
  await expect(save).toHaveAttribute("aria-label", /\S/);
  await expect(save).not.toHaveAttribute("aria-label", pl.jobs.saveLoading);
  await page.waitForLoadState("networkidle");
  expect(problems).toEqual([]);
});
