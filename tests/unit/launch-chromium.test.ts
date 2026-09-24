// @vitest-environment node
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";

import { afterEach, describe, expect, it } from "vitest";

import {
  findChromiumInBrowsersPath,
  launchChromium,
} from "../../scripts/lib/launch-chromium.mjs";
import { decodePng } from "../helpers/png-pixels";

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function tempDir(prefix: string) {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  directories.push(directory);
  return directory;
}

function touch(path: string) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, "");
}

afterEach(async () => {
  delete process.env.PLAYWRIGHT_CHROMIUM_PATH;
  await Promise.all(
    directories.splice(0).map((d) => rm(d, { recursive: true, force: true })),
  );
});

describe("wybór Chromium dla eksportu grafik (#378)", () => {
  it("wybiera najnowszy headless shell z PLAYWRIGHT_BROWSERS_PATH", async () => {
    const root = await tempDir("pw-browsers-");
    touch(join(root, "chromium-1300/chrome-linux/chrome"));
    touch(
      join(root, "chromium_headless_shell-1194/chrome-linux/headless_shell"),
    );
    touch(
      join(
        root,
        "chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
      ),
    );
    expect(findChromiumInBrowsersPath(root)).toBe(
      join(
        root,
        "chromium_headless_shell-1228/chrome-headless-shell-linux64/chrome-headless-shell",
      ),
    );
  });

  it("bez headless shell bierze pełny Chromium, a pusty katalog daje brak", async () => {
    const root = await tempDir("pw-browsers-");
    touch(join(root, "chromium-1194/chrome-linux/chrome"));
    mkdirSync(join(root, "chromium_headless_shell-1228"));
    expect(findChromiumInBrowsersPath(root)).toBe(
      join(root, "chromium-1194/chrome-linux/chrome"),
    );
    expect(
      findChromiumInBrowsersPath(await tempDir("pw-empty-")),
    ).toBeUndefined();
    expect(findChromiumInBrowsersPath(join(root, "brak"))).toBeUndefined();
    expect(findChromiumInBrowsersPath(undefined)).toBeUndefined();
  });

  it("zła PLAYWRIGHT_CHROMIUM_PATH to czytelny błąd, bez cichej zamiany przeglądarki", async () => {
    process.env.PLAYWRIGHT_CHROMIUM_PATH = "/brak/chromium";
    await expect(launchChromium()).rejects.toMatchObject({
      name: "ChromiumNotFoundError",
      message: expect.stringMatching(
        /PLAYWRIGHT_CHROMIUM_PATH=\/brak\/chromium nie istnieje.*npx playwright install chromium/,
      ),
    });
  });

  it("skrypt eksportu przy złej ścieżce kończy się błędem z instrukcją i nie zapisuje plików", async () => {
    const directory = await tempDir("pracujbe-banner-badpath-");
    const input = join(directory, "campaign.json");
    const output = join(directory, "banner");
    await writeFile(
      input,
      JSON.stringify({
        title: "Pokaż, co potrafisz. Znajdź pracę w Belgii.",
        cta: "Sprawdź oferty pracy",
        url: "https://pracuj.be/pl/oferty-pracy",
        campaign: "Paszport pracy 2026",
      }),
    );
    await expect(
      execFileAsync(
        process.execPath,
        [resolve("scripts/export-campaign-banner.mjs"), input, output],
        {
          env: {
            ...process.env,
            PLAYWRIGHT_CHROMIUM_PATH: join(directory, "brak-chromium"),
          },
        },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        /Nie znaleziono przeglądarki Chromium.*nie istnieje/,
      ),
    });
    await expect(readFile(`${output}.png`)).rejects.toThrow();
  });

  it("pusty PLAYWRIGHT_BROWSERS_PATH to czytelny błąd zamiast „Executable doesn't exist”", async () => {
    const empty = await tempDir("pw-empty-");
    const { PLAYWRIGHT_CHROMIUM_PATH: _unused, ...env } = process.env;
    await expect(
      execFileAsync(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          `import { launchChromium } from "${resolve("scripts/lib/launch-chromium.mjs")}"; await launchChromium();`,
        ],
        { env: { ...env, PLAYWRIGHT_BROWSERS_PATH: empty } },
      ),
    ).rejects.toMatchObject({
      stderr: expect.stringMatching(
        new RegExp(
          `ChromiumNotFoundError: .*brak Chromium w PLAYWRIGHT_BROWSERS_PATH=${empty}`,
        ),
      ),
    });
  });
});

describe("dekoder pikseli PNG", () => {
  const asset = join(
    process.cwd(),
    "assets/brand/organic/pl/profile-story-1080x1920.png",
  );

  function encodeUnfiltered(
    width: number,
    height: number,
    channels: number,
    data: Buffer,
  ) {
    const chunk = (type: string, body: Buffer) => {
      const head = Buffer.alloc(8);
      head.writeUInt32BE(body.length, 0);
      head.write(type, 4, "ascii");
      return Buffer.concat([head, body, Buffer.alloc(4)]); // CRC nie jest sprawdzane przez dekoder
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr.set([8, channels === 4 ? 6 : 2, 0, 0, 0], 8);
    const stride = width * channels;
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++)
      data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
    return Buffer.concat([
      Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
      chunk("IHDR", ihdr),
      chunk("IDAT", deflateSync(raw, { level: 1 })),
      chunk("IEND", Buffer.alloc(0)),
    ]);
  }

  it("ten sam obraz zakodowany innymi filtrami i kompresją daje te same piksele", async () => {
    const original = decodePng(await readFile(asset));
    expect([original.width, original.height]).toEqual([1080, 1920]);
    const reencoded = encodeUnfiltered(
      original.width,
      original.height,
      original.channels,
      original.data,
    );
    expect(reencoded.equals(await readFile(asset))).toBe(false);
    expect(decodePng(reencoded).data.equals(original.data)).toBe(true);
  });

  it("zmiana jednego piksela jest wykrywana", async () => {
    const original = decodePng(await readFile(asset));
    const changed = Buffer.from(original.data);
    const middle = changed.length >> 1;
    changed[middle] = changed[middle]! ^ 1;
    const decoded = decodePng(
      encodeUnfiltered(
        original.width,
        original.height,
        original.channels,
        changed,
      ),
    );
    expect(decoded.data.equals(original.data)).toBe(false);
  });
});
