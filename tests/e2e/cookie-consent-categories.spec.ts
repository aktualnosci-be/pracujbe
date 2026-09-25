import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { routing } from "../../src/i18n/routing";
import en from "../../src/messages/en.json";
import fr from "../../src/messages/fr.json";
import nl from "../../src/messages/nl.json";
import pl from "../../src/messages/pl.json";
import {
  buildHasCfToken,
  CF_SCRIPT,
  E2E_CF_ANALYTICS_TOKEN,
  watchAnalytics,
  type AnalyticsSeen,
} from "./fixtures/trackers";

/**
 * Zgody na cookies — kategorie, wycofanie i wersja polityki w 4 językach (#349, #570, Invariant #7).
 *
 * Od #570 jedyną statystyką jest Cloudflare Web Analytics (bez cookies), ładowany po zgodzie
 * w kategorii analitycznej; GA i Meta Pixel usunięte. Baner pyta tylko o niezbędne i analityczne
 * (bez preferencji i marketingu), wersja polityki 2.0. Żądania do Cloudflare i dawnych hostów
 * GA/Meta są przechwytywane (`watchAnalytics`) — nic nie wychodzi do dostawców. Atrapa beaconu
 * wystawia `__cfBeaconSend()`, więc sprawdzamy też bramkę wysyłki po wycofaniu zgody.
 *
 * Build E2E ma testowy token (playwright.config.ts). Build bez niego (CI przed dodaniem
 * `NEXT_PUBLIC_CF_ANALYTICS_TOKEN` do ci.yml) pomija scenariusze pozytywne — jawnie (`skip`).
 *
 * Baner jest w HTML z serwera, a skrypt w <head> (consent-boot.ts) ukrywa go przed
 * pierwszym malowaniem tylko przy ważnej zgodzie w bieżącej wersji polityki (#389).
 */

const messages = { pl, nl, fr, en } as const;

const CONSENT_COOKIE = "pracujbe_consent";
const POLICY_VERSION = process.env.NEXT_PUBLIC_CONSENT_POLICY_VERSION ?? "2.0";
const MAX_AGE_DAYS = 180;
const HAS_TOKEN = buildHasCfToken();

// Skrypty `afterInteractive` wstrzykiwane są po hydratacji — „brak żądania" sprawdzamy w oknie.
const QUIET_WINDOW_MS = 3_000;

type ConsentCall = { categories: Record<string, boolean>; source: string };

/**
 * Wywołania Server Action `recordConsent` (serwerowy dowód zgody → RPC `record_consent`).
 * Next wysyła argumenty akcji jako tablicę JSON w ciele POST z nagłówkiem `next-action`.
 */
function trackConsentActions(page: Page): ConsentCall[] {
  const calls: ConsentCall[] = [];
  page.on("request", (request) => {
    if (request.method() !== "POST" || !request.headers()["next-action"])
      return;
    let args: unknown;
    try {
      args = JSON.parse(request.postData() ?? "");
    } catch {
      return;
    }
    if (!Array.isArray(args) || typeof args[1] !== "string") return;
    const categories = args[0] as Record<string, boolean> | null;
    if (
      !categories ||
      typeof categories !== "object" ||
      !("necessary" in categories)
    )
      return;
    calls.push({ categories, source: args[1] });
  });
  return calls;
}

async function expectNoTrackers(page: Page, seen: AnalyticsSeen) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(QUIET_WINDOW_MS);
  expect(seen.script, "beacon bez zgody na analitykę").toEqual([]);
  expect(seen.rum, "wysyłki statystyki bez zgody").toEqual([]);
  expect(seen.legacy, "GA/Meta usunięte (#570)").toEqual([]);
  await expect(page.locator(CF_SCRIPT)).toHaveCount(0);
  expect(
    await page.evaluate(() => {
      const w = window as unknown as { gtag?: unknown; fbq?: unknown };
      return { gtag: typeof w.gtag, fbq: typeof w.fbq };
    }),
  ).toEqual({ gtag: "undefined", fbq: "undefined" });
}

/** Beacon załadowany z testowym tokenem, GA/Meta nigdy. */
async function expectBeacon(page: Page, seen: AnalyticsSeen) {
  await expect
    .poll(() => seen.script.length, { message: "beacon po zgodzie" })
    .toBeGreaterThan(0);
  await expect(page.locator(CF_SCRIPT)).toHaveCount(1);
  expect(
    await page.locator(CF_SCRIPT).getAttribute("data-cf-beacon"),
  ).toContain(E2E_CF_ANALYTICS_TOKEN);
  expect(seen.legacy, "GA/Meta usunięte (#570)").toEqual([]);
}

async function storeConsent(
  context: BrowserContext,
  baseURL: string,
  record: { v?: string; categories?: Record<string, boolean>; raw?: string },
) {
  const value =
    record.raw ??
    JSON.stringify({
      v: record.v ?? POLICY_VERSION,
      categories: record.categories,
      ts: new Date().toISOString(),
      id: "consent-categories-e2e",
    });
  await context.addCookies([
    {
      name: CONSENT_COOKIE,
      value: encodeURIComponent(value),
      url: baseURL,
      sameSite: "Lax",
    },
  ]);
}

/** Widoczność banera w chwili DOMContentLoaded — przed hydratacją, po skrypcie z <head>. */
async function recordBannerAtDomReady(page: Page) {
  await page.addInitScript(() => {
    document.addEventListener("DOMContentLoaded", () => {
      const banner = document.getElementById("cookie-banner");
      (
        window as unknown as { __bannerAtDomReady?: string }
      ).__bannerAtDomReady = banner
        ? getComputedStyle(banner).display
        : "missing";
    });
  });
}

/** „Akceptuj wszystkie” od #570: niezbędne + analityczne (preferencje/marketing zawsze false). */
const ALL = {
  necessary: true,
  preferences: false,
  analytics: true,
  marketing: false,
};
const NONE = {
  necessary: true,
  preferences: false,
  analytics: false,
  marketing: false,
};

for (const locale of routing.locales) {
  const m = messages[locale];
  const home = `/${locale}`;

  const banner = (page: Page) =>
    page.getByRole("region", { name: m.cookies.bannerTitle });
  const settings = (page: Page) =>
    page.getByRole("dialog", { name: m.cookies.settingsTitle });

  /** Z banera: „Dostosuj” → (opcjonalnie) włączenie analityki → „Zapisz ustawienia”. */
  async function saveFromCustomize(page: Page, analytics: boolean) {
    await banner(page)
      .getByRole("button", { name: m.cookies.customize, exact: true })
      .click();
    const dialog = settings(page);
    await expect(dialog).toBeVisible();
    // #570: jedyna kategoria opcjonalna to analityka; preferencji i marketingu nie ma.
    await expect(dialog.getByRole("switch")).toHaveCount(1);
    await expect(
      dialog.getByRole("switch", { name: m.cookies.preferencesName }),
    ).toHaveCount(0);
    await expect(
      dialog.getByRole("switch", { name: m.cookies.marketingName }),
    ).toHaveCount(0);
    const toggle = dialog.getByRole("switch", { name: m.cookies.analyticsName });
    await expect(toggle, "analityka domyślnie wyłączona").toHaveAttribute(
      "aria-checked",
      "false",
    );
    if (analytics) {
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "true");
    }
    await dialog
      .getByRole("button", { name: m.cookies.save, exact: true })
      .click();
    await expect(dialog).toBeHidden();
    await expect(banner(page)).toHaveCount(0);
  }

  test.describe(`zgody cookies (${locale})`, () => {
    test("przed zgodą i po „Tylko niezbędne” zero statystyki; zgoda zapisana na 180 dni i wysłana do serwera", async ({
      page,
      context,
    }) => {
      const seen = await watchAnalytics(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await expect(banner(page)).toBeVisible();
      await expectNoTrackers(page, seen);

      await banner(page)
        .getByRole("button", { name: m.cookies.rejectOptional, exact: true })
        .click();
      await expect(banner(page)).toHaveCount(0);
      await expectNoTrackers(page, seen);

      await expect
        .poll(() => calls.length, { message: "wywołanie recordConsent" })
        .toBe(1);
      expect(calls[0]).toEqual({ categories: NONE, source: "cookie_banner" });

      const cookie = (await context.cookies()).find(
        (c) => c.name === CONSENT_COOKIE,
      );
      expect(cookie, "cookie zgody").toBeDefined();
      const days = (cookie!.expires * 1000 - Date.now()) / 86_400_000;
      expect(days).toBeGreaterThan(MAX_AGE_DAYS - 1);
      expect(days).toBeLessThanOrEqual(MAX_AGE_DAYS);
      expect(JSON.parse(decodeURIComponent(cookie!.value))).toMatchObject({
        v: POLICY_VERSION,
        categories: NONE,
      });

      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(banner(page)).toBeHidden();
      await expectNoTrackers(page, seen);
    });

    test("centrum ustawień: analityka → beacon Cloudflare, bez GA/Meta (także po odświeżeniu)", async ({
      page,
    }) => {
      test.skip(!HAS_TOKEN, "build bez testowego tokenu Cloudflare (#570)");
      const seen = await watchAnalytics(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await saveFromCustomize(page, true);
      await expectBeacon(page, seen);

      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({ categories: ALL, source: "cookie_settings" });

      seen.script.length = 0;
      await page.reload();
      await expectBeacon(page, seen);
    });

    test("centrum ustawień: zapis z wyłączoną analityką = brak statystyki", async ({
      page,
    }) => {
      const seen = await watchAnalytics(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await saveFromCustomize(page, false);
      await expectNoTrackers(page, seen);
      await expect.poll(() => calls.length).toBe(1);
      expect(calls[0]).toEqual({ categories: NONE, source: "cookie_settings" });
    });

    test("wycofanie zgody ze stopki: beacon nic nie wysyła, cookies GA/Meta usunięte, po odświeżeniu zero żądań", async ({
      page,
      context,
    }) => {
      test.skip(!HAS_TOKEN, "build bez testowego tokenu Cloudflare (#570)");
      const seen = await watchAnalytics(page);
      const calls = trackConsentActions(page);
      await page.goto(home);
      await banner(page)
        .getByRole("button", { name: m.cookies.acceptAll, exact: true })
        .click();
      await expect(banner(page)).toHaveCount(0);
      await expectBeacon(page, seen);

      // Kontrola ujemna bramki: ze zgodą wysyłka beaconu przechodzi.
      await expect
        .poll(() =>
          page.evaluate(() =>
            (window as unknown as { __cfBeaconSend?: () => boolean }).__cfBeaconSend?.(),
          ),
        )
        .toBe(true);
      await expect.poll(() => seen.rum.length).toBe(1);

      // Pozostałości dawnych trackerów z wcześniejszych wizyt.
      await page.evaluate(() => {
        for (const name of ["_ga", "_ga_TEST000000", "_gid", "_fbp", "_fbc"]) {
          document.cookie = `${name}=1; Path=/`;
        }
      });

      await page
        .getByRole("contentinfo")
        .getByRole("button", { name: m.footer.cookieSettings, exact: true })
        .click();
      const dialog = settings(page);
      await expect(dialog).toBeVisible();
      const toggle = dialog.getByRole("switch", { name: m.cookies.analyticsName });
      await expect(toggle, "centrum pokazuje zapisaną zgodę").toHaveAttribute(
        "aria-checked",
        "true",
      );
      await toggle.click();
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await dialog
        .getByRole("button", { name: m.cookies.save, exact: true })
        .click();
      await expect(dialog).toBeHidden();

      await expect
        .poll(async () =>
          (await context.cookies())
            .map((c) => c.name)
            .filter((n) => /^_(ga|gid|fb)/.test(n)),
        )
        .toEqual([]);
      // Załadowany skrypt zostaje w karcie, ale jego wysyłki blokuje bramka.
      expect(
        await page.evaluate(() =>
          (window as unknown as { __cfBeaconSend?: () => boolean }).__cfBeaconSend?.(),
        ),
      ).toBe(false);
      await page.waitForTimeout(1_000);
      expect(seen.rum, "po wycofaniu żadnej wysyłki").toHaveLength(1);

      await expect.poll(() => calls.length).toBe(2);
      expect(calls).toEqual([
        { categories: ALL, source: "cookie_banner" },
        { categories: NONE, source: "cookie_settings" },
      ]);

      seen.script.length = 0;
      seen.rum.length = 0;
      await page.reload();
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(banner(page)).toBeHidden();
      await expectNoTrackers(page, seen);
    });

    test("ważna zgoda w bieżącej wersji: baner ukryty przed hydratacją, beacon po zgodzie analitycznej", async ({
      page,
      context,
      baseURL,
    }) => {
      test.skip(!HAS_TOKEN, "build bez testowego tokenu Cloudflare (#570)");
      await storeConsent(context, baseURL!, { categories: ALL });
      const seen = await watchAnalytics(page);
      await recordBannerAtDomReady(page);
      await page.goto(home);

      expect(
        await page.evaluate(
          () => (window as { __bannerAtDomReady?: string }).__bannerAtDomReady,
        ),
      ).toBe("none");
      await expect(banner(page)).toHaveCount(0);
      await expectBeacon(page, seen);
    });

    for (const [label, record] of [
      [
        "zgoda na wszystko w poprzedniej wersji polityki (1.0, z marketingiem)",
        {
          v: "1.0",
          categories: { necessary: true, preferences: true, analytics: true, marketing: true },
        },
      ],
      [
        "zgoda w innej wersji polityki",
        { v: `${POLICY_VERSION}-stara`, categories: ALL },
      ],
      [
        "uszkodzone cookie zgody",
        { raw: '{"v":"' + POLICY_VERSION + '","categories":' },
      ],
      [
        "obcy JSON w cookie zgody",
        { raw: JSON.stringify({ analytics: true, marketing: true }) },
      ],
    ] as const) {
      test(`${label} → baner pyta ponownie, statystyka się nie ładuje`, async ({
        page,
        context,
        baseURL,
      }) => {
        await storeConsent(context, baseURL!, record);
        const seen = await watchAnalytics(page);
        const calls = trackConsentActions(page);
        await recordBannerAtDomReady(page);
        await page.goto(home);

        expect(
          await page.evaluate(
            () =>
              (window as { __bannerAtDomReady?: string }).__bannerAtDomReady,
          ),
          "baner z serwera nie jest ukrywany przed hydratacją",
        ).not.toBe("none");
        await expect(banner(page)).toBeVisible();
        expect(
          await page.evaluate(() =>
            document.documentElement.getAttribute("data-consent"),
          ),
        ).toBeNull();
        await expectNoTrackers(page, seen);

        // Nowa odpowiedź zastępuje nieaktualną zgodę bieżącą wersją polityki.
        await banner(page)
          .getByRole("button", { name: m.cookies.rejectOptional, exact: true })
          .click();
        await expect(banner(page)).toHaveCount(0);
        const cookie = (await context.cookies()).find(
          (c) => c.name === CONSENT_COOKIE,
        );
        expect(JSON.parse(decodeURIComponent(cookie!.value))).toMatchObject({
          v: POLICY_VERSION,
          categories: NONE,
        });
        await expect.poll(() => calls.length).toBe(1);
        await expectNoTrackers(page, seen);
      });
    }
  });
}
