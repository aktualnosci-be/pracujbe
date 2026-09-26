import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * #623 — `.env.example` bez znaczników konfliktu scalania. Linia `=======` / `<<<<<<<` /
 * `>>>>>>>` po skopiowaniu do `.env` psuje parsowanie (dotenv traktuje ją jak śmieć albo
 * przerywa blok) i myli operatora konfiguracji.
 */
const MARKER = /^(<{7}|={7}|>{7})(\s|$)/m;

function markerLines(text: string): string[] {
  return text.split('\n').filter((line) => MARKER.test(line));
}

describe('.env.example', () => {
  it('nie zawiera znaczników konfliktu scalania', () => {
    const text = readFileSync(join(process.cwd(), '.env.example'), 'utf8');
    expect(markerLines(text)).toEqual([]);
  });

  it('kontrola ujemna: plik ze znacznikiem jest wykrywany', () => {
    const broken = 'A="1"\n<<<<<<< HEAD\nB="2"\n=======\nB="3"\n>>>>>>> main\n';
    expect(markerLines(broken)).toEqual(['<<<<<<< HEAD', '=======', '>>>>>>> main']);
    // Separatory sekcji z komentarzem (`# ====`) nie są znacznikiem.
    expect(markerLines('# ======================\nA="1"\n')).toEqual([]);
  });
});
