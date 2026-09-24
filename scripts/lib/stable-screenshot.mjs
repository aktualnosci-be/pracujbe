/**
 * Zrzut strony dla skryptów eksportu grafik bez niestabilności na obciążonym runnerze.
 *
 * `Page.captureScreenshot` w Chromium kopiuje ostatnią ramkę kompozytora. Zaraz po
 * `setContent`, gdy kilka przeglądarek dzieli 2 CPU (równoległe pliki Vitest), ramki
 * z nową treścią może jeszcze nie być i protokół zwraca „Unable to capture screenshot”
 * (main 514e917). Dlatego:
 * 1. czekamy na fonty i na dwie kolejne ramki z niezmienionym układem;
 * 2. tylko ten jeden błąd protokołu ponawiamy, najwyżej `attempts` razy, z wpisem na stderr.
 * Każdy inny błąd przechodzi od razu.
 */

export const SCREENSHOT_ATTEMPTS = 3;

const TRANSIENT_CAPTURE_ERROR = /Unable to capture screenshot/i;

export function isTransientCaptureError(error) {
  return error instanceof Error && TRANSIENT_CAPTURE_ERROR.test(error.message);
}

/** Fonty wczytane i dwie kolejne ramki z tym samym rozmiarem dokumentu. */
export async function waitForStableFrame(page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    const frame = () =>
      new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const size = () => {
      const rect = document.documentElement.getBoundingClientRect();
      return `${rect.width}x${rect.height}`;
    };
    let previous = size();
    // Limit ramek: układ bez animacji stabilizuje się w 1–2 ramkach.
    for (let index = 0; index < 20; index += 1) {
      await frame();
      await frame();
      const current = size();
      if (current === previous) return;
      previous = current;
    }
  });
}

const defaultLog = (message) => {
  process.stderr.write(`${message}\n`);
};

export async function captureStableScreenshot(
  page,
  options,
  { attempts = SCREENSHOT_ATTEMPTS, log = defaultLog, delayMs = 250 } = {},
) {
  for (let attempt = 1; ; attempt += 1) {
    await waitForStableFrame(page);
    try {
      return await page.screenshot(options);
    } catch (error) {
      if (!isTransientCaptureError(error) || attempt >= attempts) throw error;
      log(
        `Zrzut ekranu: próba ${attempt}/${attempts} nieudana (${error.message.split("\n")[0]}), ponawiam.`,
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
    }
  }
}
