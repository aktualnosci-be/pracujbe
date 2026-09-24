import 'server-only';

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Font DM Sans osadzany w SVG baneru (#175) — ten sam plik co `next/font/local` portalu
 * (SIL OFL 1.1, osadzanie dozwolone). Bez fontu baner nadal jest poprawny (Arial), więc błąd
 * odczytu nie blokuje eksportu.
 */
let cached: Promise<string | undefined> | undefined;

export function bannerFontBase64(): Promise<string | undefined> {
  cached ??= readFile(join(process.cwd(), 'src', 'app', 'fonts', 'DMSans-latin.woff2'))
    .then((buffer) => buffer.toString('base64'))
    .catch(() => undefined);
  return cached;
}
