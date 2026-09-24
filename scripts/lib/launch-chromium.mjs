import { chromium } from "@playwright/test";

/**
 * Chromium dla skryptów eksportu grafik (#378). Gdy środowisko ma preinstalowaną przeglądarkę
 * (`PLAYWRIGHT_CHROMIUM_PATH`, np. /opt/pw-browsers/chromium), używamy jej — jak
 * playwright.config.ts. Bez zmiennej zachowanie domyślne (CI: `playwright install`).
 */
export function launchChromium() {
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH || undefined;
  return chromium.launch(executablePath ? { executablePath } : undefined);
}
