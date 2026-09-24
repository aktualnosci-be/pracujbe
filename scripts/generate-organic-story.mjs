import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { launchChromium } from "./lib/launch-chromium.mjs";
import { captureStableScreenshot } from "./lib/stable-screenshot.mjs";

const source = resolve("assets/brand/organic/pl/profile-story-1080x1920.svg");
const output = resolve(
  process.argv[2] ?? "assets/brand/organic/pl/profile-story-1080x1920.png",
);

await mkdir(dirname(output), { recursive: true });

const svg = await readFile(source, "utf8");
const browser = await launchChromium();

try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 1920, width: 1080 },
  });
  await page.setContent(
    `<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden}</style>${svg}`,
  );
  await captureStableScreenshot(page, {
    animations: "disabled",
    path: output,
    type: "png",
  });
  // Wersja przeglądarki: test porównujący PNG bajt w bajt podaje ją w komunikacie (#378).
  console.log(`chromium ${browser.version()}`);
} finally {
  await browser.close();
}
