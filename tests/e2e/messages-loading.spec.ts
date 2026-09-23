import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

for (const locale of ["pl", "nl", "fr", "en"] as const) {
  for (const role of ["candidate", "employer"] as const) {
    for (const width of [320, 640] as const) {
      test(`wiadomości: stan ładowania ${role}, ${locale} przy ${width} px`, async ({
        page,
      }) => {
        const messages = JSON.parse(
          readFileSync(resolve("src/messages", `${locale}.json`), "utf8"),
        ) as {
          dashboard: { navMessages: string };
          messages: {
            loading: string;
            opening: string;
            title: string;
            composerPlaceholder: string;
          };
          nav: { menu: string };
        };
        await page.setViewportSize({ width, height: 800 });
        await page.goto(`/${locale}/${role}`);

        let delayed = false;
        await page.route(`**/${locale}/${role}/wiadomosci*`, async (route) => {
          if (route.request().headers()["rsc"] === "1") {
            delayed = true;
            await new Promise((resolveDelay) => setTimeout(resolveDelay, 1500));
          }
          await route.continue();
        });

        await page
          .getByRole("button", { name: messages.nav.menu })
          .first()
          .click();
        await page
          .getByRole("dialog")
          .getByRole("link", { name: messages.dashboard.navMessages })
          .click({ noWaitAfter: true });
        await expect(page.getByRole("status")).toContainText(
          messages.messages.loading,
        );
        await expect.poll(() => delayed, 'Przejście powinno czekać na odpowiedź RSC.').toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth - innerWidth,
          ),
        ).toBeLessThanOrEqual(1);
        await expect(page).toHaveURL(
          new RegExp(`/${locale}/${role}/wiadomosci$`),
        );
        await expect(
          page.getByRole("list", { name: messages.messages.title }),
        ).toBeVisible();
        await expect(page.getByRole("status")).toHaveCount(0);

        // Zmiana samego ?c= nie aktywuje route-level loading.tsx.
        delayed = false;
        const conversation = page
          .getByRole("list", { name: messages.messages.title })
          .getByRole("link")
          .first();
        await conversation.click({ noWaitAfter: true });
        await expect(conversation.getByRole("status")).toContainText(
          messages.messages.opening,
        );
        await expect
          .poll(() => delayed, "Odczyt wątku powinien czekać na odpowiedź RSC.")
          .toBe(true);
        await expect(
          page.getByRole("textbox", {
            name: messages.messages.composerPlaceholder,
          }),
        ).toBeVisible();
        await expect(page.getByRole("status")).toHaveCount(0);
      });
    }
  }
}
