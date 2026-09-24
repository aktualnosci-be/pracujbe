import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { chromium } from "@playwright/test";

/**
 * Chromium dla skryptów eksportu grafik (#378). Kolejność:
 * 1. `PLAYWRIGHT_CHROMIUM_PATH` — jawna ścieżka (jak playwright.config.ts); nieistniejący plik
 *    to czytelny błąd, bez cichego przejścia na inną przeglądarkę.
 * 2. Przeglądarka z `npx playwright install` w rewizji tej wersji Playwright (CI — bez zmian).
 * 3. Inna rewizja w `PLAYWRIGHT_BROWSERS_PATH` (np. preinstalowane /opt/pw-browsers): najpierw
 *    headless shell (ten sam wariant co domyślny headless), potem pełny Chromium, najnowsza.
 * Brak przeglądarki = błąd z instrukcją zamiast komunikatu „Executable doesn't exist”.
 */

// Położenie pliku wykonywalnego w katalogu rewizji (Linux / macOS / Windows).
const LAYOUTS = [
  {
    prefix: "chromium_headless_shell-",
    files: [
      "chrome-headless-shell-linux64/chrome-headless-shell",
      "chrome-linux/headless_shell",
      "chrome-headless-shell-mac-arm64/chrome-headless-shell",
      "chrome-headless-shell-mac-x64/chrome-headless-shell",
      "chrome-headless-shell-win64/chrome-headless-shell.exe",
    ],
  },
  {
    prefix: "chromium-",
    files: [
      "chrome-linux64/chrome",
      "chrome-linux/chrome",
      "chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing",
      "chrome-mac/Chromium.app/Contents/MacOS/Chromium",
      "chrome-win64/chrome.exe",
      "chrome-win/chrome.exe",
    ],
  },
];

class ChromiumNotFoundError extends Error {
  constructor(message) {
    super(message);
    this.name = "ChromiumNotFoundError";
  }
}

/** Najnowszy Chromium z katalogu przeglądarek Playwright albo `undefined`. */
export function findChromiumInBrowsersPath(browsersPath) {
  if (!browsersPath || !existsSync(browsersPath)) return undefined;
  const entries = readdirSync(browsersPath);
  for (const { prefix, files } of LAYOUTS) {
    const revisions = entries
      .filter((name) => new RegExp(`^${prefix}\\d+$`).test(name))
      .sort(
        (a, b) =>
          Number(b.slice(prefix.length)) - Number(a.slice(prefix.length)),
      );
    for (const revision of revisions) {
      for (const file of files) {
        const candidate = join(browsersPath, revision, file);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

function missingBrowserMessage(detail) {
  return [
    `Nie znaleziono przeglądarki Chromium do eksportu grafik (${detail}).`,
    "Ustaw PLAYWRIGHT_CHROMIUM_PATH na plik wykonywalny Chromium,",
    "ustaw PLAYWRIGHT_BROWSERS_PATH na katalog z przeglądarkami Playwright",
    "albo uruchom `npx playwright install chromium`.",
  ].join(" ");
}

function isMissingExecutable(error) {
  return (
    error instanceof Error && /Executable doesn't exist/i.test(error.message)
  );
}

export async function launchChromium() {
  const explicit = process.env.PLAYWRIGHT_CHROMIUM_PATH;
  if (explicit) {
    if (!existsSync(explicit)) {
      throw new ChromiumNotFoundError(
        missingBrowserMessage(
          `PLAYWRIGHT_CHROMIUM_PATH=${explicit} nie istnieje`,
        ),
      );
    }
    return chromium.launch({ executablePath: explicit });
  }

  try {
    return await chromium.launch();
  } catch (error) {
    if (!isMissingExecutable(error)) throw error;
    const browsersPath = process.env.PLAYWRIGHT_BROWSERS_PATH;
    const fallback = findChromiumInBrowsersPath(browsersPath);
    if (!fallback) {
      throw new ChromiumNotFoundError(
        missingBrowserMessage(
          browsersPath
            ? `brak Chromium w PLAYWRIGHT_BROWSERS_PATH=${browsersPath}`
            : "brak przeglądarki z `playwright install` dla tej wersji Playwright",
        ),
      );
    }
    return chromium.launch({ executablePath: fallback });
  }
}
