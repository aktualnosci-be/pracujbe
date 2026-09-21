import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import manifest from "@/app/manifest";

const PUBLIC = join(process.cwd(), "public");

function pngDimensions(name: string): { width: number; height: number } {
  const data = readFileSync(join(PUBLIC, name));
  expect(data.subarray(0, 8)).toEqual(
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  );
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
}

describe("zasoby marki Pracuj.be", () => {
  it.each([
    ["icon-32.png", 32, 32],
    ["icon-192.png", 192, 192],
    ["icon-512.png", 512, 512],
    ["icon-maskable-192.png", 192, 192],
    ["icon-maskable-512.png", 512, 512],
    ["apple-touch-icon.png", 180, 180],
    ["og.png", 1200, 630],
  ])("%s ma deklarowany rozmiar", (name, width, height) => {
    expect(pngDimensions(name)).toEqual({ width, height });
  });

  it("manifest odwołuje się wyłącznie do istniejących ikon PNG", () => {
    const value = manifest();
    expect(value.theme_color).toBe("#D92932");
    for (const icon of value.icons ?? []) {
      const name = String(icon.src).replace(/^\//, "");
      expect(icon.type).toBe("image/png");
      expect(pngDimensions(name)).toEqual({
        width: Number(String(icon.sizes).split("x")[0]),
        height: Number(String(icon.sizes).split("x")[1]),
      });
    }
  });

  it("wektorowy favicon używa zatwierdzonego czerwonego kafelka i białego .be", () => {
    const svg = readFileSync(join(PUBLIC, "icon.svg"), "utf8");
    expect(svg).toContain("#D92932");
    expect(svg).toContain('fill="#fff"');
    expect(svg).toContain(">.be</text>");
  });
});
