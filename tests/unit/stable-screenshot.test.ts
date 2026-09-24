// @vitest-environment node
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import {
  SCREENSHOT_ATTEMPTS,
  captureStableScreenshot,
  isTransientCaptureError,
} from '../../scripts/lib/stable-screenshot.mjs';
import { CHROMIUM_TEST_FILES } from '../../vitest.config';

const TRANSIENT =
  'page.screenshot: Protocol error (Page.captureScreenshot): Unable to capture screenshot';

function fakePage(results: Array<Buffer | Error>) {
  const screenshot = vi.fn(async () => {
    const next = results.shift();
    if (next instanceof Error) throw next;
    return next;
  });
  const evaluate = vi.fn(async () => undefined);
  return { page: { screenshot, evaluate }, screenshot, evaluate };
}

describe('stabilny zrzut w eksporcie grafik (main 514e917)', () => {
  it('rozpoznaje tylko przejściowy błąd kopiowania ramki', () => {
    expect(isTransientCaptureError(new Error(TRANSIENT))).toBe(true);
    expect(isTransientCaptureError(new Error('Target page, context or browser has been closed'))).toBe(false);
    expect(isTransientCaptureError('Unable to capture screenshot')).toBe(false);
  });

  it('przed każdym zrzutem czeka na stabilną ramkę', async () => {
    const png = Buffer.from('png');
    const { page, evaluate, screenshot } = fakePage([png]);
    await expect(captureStableScreenshot(page, { type: 'png' }, { log: () => {} })).resolves.toBe(png);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(screenshot).toHaveBeenCalledWith({ type: 'png' });
  });

  it('ponawia przejściowy błąd z wpisem w logu i zwraca obraz', async () => {
    const png = Buffer.from('png');
    const log = vi.fn();
    const { page, screenshot, evaluate } = fakePage([new Error(TRANSIENT), png]);
    await expect(captureStableScreenshot(page, { type: 'png' }, { log, delayMs: 0 })).resolves.toBe(png);
    expect(screenshot).toHaveBeenCalledTimes(2);
    expect(evaluate).toHaveBeenCalledTimes(2);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toMatch(/próba 1\/3.*Unable to capture screenshot.*ponawiam/);
  });

  it('po wyczerpaniu prób zgłasza oryginalny błąd', async () => {
    const log = vi.fn();
    const { page, screenshot } = fakePage(
      Array.from({ length: SCREENSHOT_ATTEMPTS + 1 }, () => new Error(TRANSIENT)),
    );
    await expect(captureStableScreenshot(page, {}, { log, delayMs: 0 })).rejects.toThrow(
      /Unable to capture screenshot/,
    );
    expect(screenshot).toHaveBeenCalledTimes(SCREENSHOT_ATTEMPTS);
    expect(log).toHaveBeenCalledTimes(SCREENSHOT_ATTEMPTS - 1);
  });

  it('innego błędu nie ponawia', async () => {
    const log = vi.fn();
    const { page, screenshot } = fakePage([new Error('Target closed'), Buffer.from('x')]);
    await expect(captureStableScreenshot(page, {}, { log, delayMs: 0 })).rejects.toThrow('Target closed');
    expect(screenshot).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('każdy skrypt z Chromium robi zrzut tylko przez captureStableScreenshot', () => {
    // Skrypty z Chromium, które robią zrzuty (bramka perf-lab.mjs, #395, tylko mierzy).
    const scripts = readdirSync('scripts')
      .filter((name) => name.endsWith('.mjs'))
      .map((name) => join('scripts', name))
      .filter((script) => {
        const source = readFileSync(script, 'utf8');
        return source.includes('launchChromium') && /screenshot/i.test(source);
      });
    expect(scripts).toEqual(
      expect.arrayContaining([
        'scripts/export-campaign-banner.mjs',
        'scripts/export-job-post.mjs',
        'scripts/generate-organic-story.mjs',
      ]),
    );
    for (const script of scripts) {
      const source = readFileSync(script, 'utf8');
      expect(source, script).toContain('captureStableScreenshot(page');
      expect(source, script).not.toMatch(/page\.screenshot\(/);
    }
  });

  it('każdy test uruchamiający Chromium jest w projekcie `chromium` (jeden plik naraz)', () => {
    const chromiumScripts = readdirSync('scripts')
      .filter((name) => name.endsWith('.mjs'))
      .filter((name) => readFileSync(join('scripts', name), 'utf8').includes('launchChromium'));
    expect(chromiumScripts.length).toBeGreaterThan(0);
    const pattern = new RegExp(
      [...chromiumScripts.map((name) => name.replace('.', '\\.')), 'launch-chromium'].join('|'),
    );
    const files = readdirSync('tests/unit')
      .filter((name) => /\.test\.tsx?$/.test(name) && name !== 'stable-screenshot.test.ts')
      .filter((name) => pattern.test(readFileSync(join('tests/unit', name), 'utf8')))
      .map((name) => `tests/unit/${name}`);
    expect(files.sort()).toEqual([...CHROMIUM_TEST_FILES].sort());
  });
});
