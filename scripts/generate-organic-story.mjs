import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "@playwright/test";

const source = resolve("assets/brand/organic/pl/profile-story-1080x1920.svg");
const output = resolve(
  process.argv[2] ?? "assets/brand/organic/pl/profile-story-1080x1920.png",
);

await mkdir(dirname(output), { recursive: true });

const svg = await readFile(source, "utf8");
const browser = await chromium.launch();

try {
  const page = await browser.newPage({
    deviceScaleFactor: 1,
    viewport: { height: 1920, width: 1080 },
  });
  await page.setContent(
    `<style>html,body{margin:0;width:1080px;height:1920px;overflow:hidden}</style>${svg}`,
  );
  await page.screenshot({ animations: "disabled", path: output, type: "png" });
} finally {
  await browser.close();
}
