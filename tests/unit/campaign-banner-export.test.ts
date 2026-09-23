import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const SCRIPT = resolve("scripts/export-campaign-banner.mjs");
const VALID = {
  title: "Pokaż, co potrafisz. Znajdź pracę w Belgii.",
  cta: "Sprawdź oferty pracy",
  url: "https://pracuj.be/pl/oferty-pracy?utm_campaign=paszport",
  campaign: "Paszport pracy 2026",
};

async function withExport(
  campaign: Record<string, unknown>,
  check: (paths: { svg: string; png: string }) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), "pracujbe-banner-"));
  const input = join(directory, "campaign.json");
  const output = join(directory, "banner");
  await writeFile(input, JSON.stringify(campaign));
  try {
    await execFileAsync(process.execPath, [SCRIPT, input, output]);
    await check({ svg: `${output}.svg`, png: `${output}.png` });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function rejectsCampaign(
  campaign: Record<string, unknown>,
  expected: RegExp,
) {
  const directory = await mkdtemp(join(tmpdir(), "pracujbe-banner-reject-"));
  const input = join(directory, "campaign.json");
  const output = join(directory, "banner");
  await writeFile(input, JSON.stringify(campaign));
  try {
    await expect(
      execFileAsync(process.execPath, [SCRIPT, input, output]),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(expected),
    });
    await expect(readFile(`${output}.svg`)).rejects.toThrow();
    await expect(readFile(`${output}.png`)).rejects.toThrow();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

describe("eksport baneru kampanii 1200 × 300", () => {
  it("tworzy SVG i PNG o właściwym rozmiarze, z jawnym adresem i identyfikacją marki", async () => {
    await withExport(VALID, async ({ svg, png }) => {
      const markup = await readFile(svg, "utf8");
      const image = await readFile(png);
      expect(markup).toContain('viewBox="0 0 1200 300"');
      expect(markup).toContain("Pokaż, co potrafisz.");
      expect(markup).toContain("Sprawdź oferty pracy");
      expect(markup).toContain("Paszport pracy 2026");
      expect(markup).toContain(
        "https://pracuj.be/pl/oferty-pracy?utm_campaign=paszport",
      );
      expect(markup).toContain("#D92932");
      expect(markup).toContain("#151515");
      expect(markup).toContain(">pracuj</text>");
      expect(markup).toContain(">.be</text>");
      expect(markup).not.toMatch(
        /materiał demonstracyjny|lorem ipsum|przykładowa oferta/i,
      );
      expect(image.subarray(0, 8)).toEqual(
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      );
      expect(image.readUInt32BE(16)).toBe(1200);
      expect(image.readUInt32BE(20)).toBe(300);
    });
  }, 60_000);

  it("ucieka znaki SVG i adresu, nie pozwalając wstrzyknąć znacznika", async () => {
    await withExport(
      {
        ...VALID,
        title: "Praca & rozwój <teraz>",
        url: "https://pracuj.be/pl/oferty-pracy?utm_campaign=paszport&source=baner",
      },
      async ({ svg }) => {
        const markup = await readFile(svg, "utf8");
        expect(markup).toContain("Praca &amp; rozwój &lt;teraz&gt;");
        expect(markup).not.toContain("<teraz>");
        expect(markup).toContain("?utm_campaign=paszport&amp;source=baner");
      },
    );
  }, 60_000);

  it("odrzuca wartości demonstracyjne, puste pola i adresy poza portalem", async () => {
    await rejectsCampaign(
      { ...VALID, title: "Przykładowy tytuł" },
      /title:.*demonstracyjny/i,
    );
    await rejectsCampaign({ ...VALID, cta: "  " }, /cta:.*niepusty/i);
    await rejectsCampaign(
      { ...VALID, campaign: "Demo kampanii" },
      /campaign:.*demonstracyjny/i,
    );
    await rejectsCampaign(
      { ...VALID, title: "Praca\nteraz" },
      /title:.*sterujące/i,
    );
    await rejectsCampaign(
      { ...VALID, url: "javascript:alert(1)" },
      /url:.*HTTPS/i,
    );
    await rejectsCampaign(
      { ...VALID, url: "https://pracuj.be.evil.test/pl" },
      /url:.*HTTPS/i,
    );
    await rejectsCampaign(
      { ...VALID, url: "https://pracuj.be/pl#inny" },
      /url:.*HTTPS/i,
    );
  }, 60_000);

  it("odrzuca napis, którego nie można zmieścić w przycisku lub dwóch liniach", async () => {
    await rejectsCampaign(
      {
        ...VALID,
        cta: "Bardzo długi przycisk, którego nie można zmieścić na tym banerze",
      },
      /cta:.*mieści/i,
    );
    await rejectsCampaign(
      { ...VALID, title: "Praca ".repeat(40) },
      /title:.*mieści/i,
    );
    await rejectsCampaign(
      { ...VALID, campaign: "Długa nazwa kampanii ".repeat(8) },
      /campaign:.*mieści/i,
    );
  }, 60_000);
});
