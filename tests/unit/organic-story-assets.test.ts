import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { execFile } from "node:child_process";

import { describe, expect, it } from "vitest";

const STORY_DIR = join(process.cwd(), "assets/brand/organic/pl");
const README = join(process.cwd(), "assets/brand/organic/README.md");
const SVG_NAME = "profile-story-1080x1920.svg";
const PNG_NAME = "profile-story-1080x1920.png";
const execFileAsync = promisify(execFile);

function relativeLuminance(hex: string): number {
  const [red = 0, green = 0, blue = 0] = hex
    .slice(1)
    .match(/.{2}/g)!
    .map((channel) => Number.parseInt(channel, 16) / 255)
    .map((channel) =>
      channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4,
    );

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(foreground: string, background: string): number {
  const [lighter = 0, darker = 0] = [
    relativeLuminance(foreground),
    relativeLuminance(background),
  ].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("organiczne Story PL", () => {
  it("ma właściwy rozmiar źródła i eksportu", () => {
    const svg = readFileSync(join(STORY_DIR, SVG_NAME), "utf8");
    expect(svg).toContain('width="1080"');
    expect(svg).toContain('height="1920"');
    expect(svg).toContain('viewBox="0 0 1080 1920"');

    const png = readFileSync(join(STORY_DIR, PNG_NAME));
    expect(png.subarray(0, 8)).toEqual(
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    );
    expect(png.readUInt32BE(16)).toBe(1080);
    expect(png.readUInt32BE(20)).toBe(1920);
  });

  it("używa zatwierdzonej palety i jest samowystarczalne", () => {
    const svg = readFileSync(join(STORY_DIR, SVG_NAME), "utf8");
    const colors = [...svg.matchAll(/#[0-9a-f]{6}/gi)].map(([color]) =>
      color.toUpperCase(),
    );

    expect(new Set(colors)).toEqual(
      new Set([
        "#151515",
        "#666666",
        "#D92932",
        "#DDDDDD",
        "#F7F7F7",
        "#FFFFFF",
      ]),
    );
    expect(svg).not.toMatch(/<text\b|font-family|@font-face/i);
    expect(svg).not.toMatch(
      /<image\b|<foreignObject\b|\bhref\s*=|\burl\s*\(|data:/i,
    );
    expect(svg.replace('xmlns="http://www.w3.org/2000/svg"', "")).not.toMatch(
      /https?:/i,
    );
  });

  it("zapewnia kontrast par tekstu i tła", () => {
    expect(contrastRatio("#151515", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#666666", "#F7F7F7")).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#D92932", "#F7F7F7")).toBeGreaterThanOrEqual(3);
    expect(contrastRatio("#FFFFFF", "#D92932")).toBeGreaterThanOrEqual(3);
  });

  it("odtwarza identyczny PNG z repozytorium", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pracujbe-story-"));
    const generated = join(directory, PNG_NAME);

    try {
      await execFileAsync(process.execPath, [
        join(process.cwd(), "scripts/generate-organic-story.mjs"),
        generated,
      ]);
      expect(await readFile(generated)).toEqual(
        await readFile(join(STORY_DIR, PNG_NAME)),
      );
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  // Na współdzielonym runnerze uruchomienie Chromium może potrwać dłużej.
  }, 60_000);

  it("nie zawiera markerów wersji demonstracyjnej", () => {
    const svg = readFileSync(join(STORY_DIR, SVG_NAME), "utf8");
    expect(svg).toContain("Pokaż, co potrafisz.");
    expect(svg).toContain("Stwórz swój profil.");
    expect(svg).not.toMatch(/demo|demonstracyj|przykładow/i);
  });

  it("opisuje granicę publikacji organicznej i adres docelowy", () => {
    const readme = readFileSync(README, "utf8");
    expect(readme).toContain("bezpłatnej publikacji");
    expect(readme).toContain("Nie jest planem kampanii, reklamą płatną");
    expect(readme).toContain("`/pl/rejestracja`");
    expect(readme.replace(/\s+/g, " ")).toContain(
      "Grafika Pracuj.be: Pokaż, co potrafisz. Stwórz swój profil zawodowy bez układania CV.",
    );
  });
});
