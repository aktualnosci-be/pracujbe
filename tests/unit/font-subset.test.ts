import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { brotliDecompressSync } from 'node:zlib';

import { describe, expect, it } from 'vitest';

/**
 * #388 — font DM Sans (od #5/#7; wcześniej Inter) jako podzbiór łaciński (strażnik rozmiaru i pokrycia znaków).
 *
 * Plik powstaje skryptem `scripts/subset-font.py` z `assets/fonts/DMSans-4.004[opsz,wght].ttf`.
 * Test czyta WOFF2 bez zależności: nagłówek, katalog tabel, strumień Brotli, a z niego
 * tabele `cmap` (obsługiwane znaki) i `fvar` (zakres osi wagi).
 */

const ROOT = process.cwd();
const FONT = join(ROOT, 'src', 'app', 'fonts', 'DMSans-latin.woff2');
const MAX_BYTES = 60 * 1024;

/** Kolejność znanych tagów WOFF2 (spec, tabela „Known Table Tags”) — potrzebne cmap i fvar. */
const KNOWN_TAGS: Record<number, string> = { 0: 'cmap', 10: 'glyf', 11: 'loca', 47: 'fvar' };

function readBase128(data: Buffer, offset: number): [number, number] {
  let value = 0;
  for (let i = 0; i < 5; i += 1) {
    const byte = data[offset + i]!;
    value = value * 128 + (byte & 0x7f);
    if ((byte & 0x80) === 0) return [value, offset + i + 1];
  }
  throw new Error('niepoprawny UIntBase128');
}

function woff2Tables(file: Buffer): Map<string, Buffer> {
  expect(file.subarray(0, 4).toString('latin1')).toBe('wOF2');
  const numTables = file.readUInt16BE(12);
  const compressedSize = file.readUInt32BE(20);
  let offset = 48;
  const entries: Array<{ tag: string; length: number }> = [];
  for (let i = 0; i < numTables; i += 1) {
    const flags = file[offset]!;
    offset += 1;
    let tag = KNOWN_TAGS[flags & 0x3f] ?? `#${flags & 0x3f}`;
    if ((flags & 0x3f) === 63) {
      tag = file.subarray(offset, offset + 4).toString('latin1');
      offset += 4;
    }
    const transform = (flags >> 6) & 0x03;
    let origLength: number;
    [origLength, offset] = readBase128(file, offset);
    let length = origLength;
    const glyfOrLoca = tag === 'glyf' || tag === 'loca';
    if ((glyfOrLoca && transform === 0) || (!glyfOrLoca && transform !== 0)) {
      [length, offset] = readBase128(file, offset);
    }
    entries.push({ tag, length });
  }
  const stream = brotliDecompressSync(file.subarray(offset, offset + compressedSize));
  const tables = new Map<string, Buffer>();
  let cursor = 0;
  for (const entry of entries) {
    tables.set(entry.tag, stream.subarray(cursor, cursor + entry.length));
    cursor += entry.length;
  }
  return tables;
}

function cmapCodepoints(cmap: Buffer): Set<number> {
  const codepoints = new Set<number>();
  const count = cmap.readUInt16BE(2);
  for (let i = 0; i < count; i += 1) {
    const sub = cmap.readUInt32BE(4 + i * 8 + 4);
    const format = cmap.readUInt16BE(sub);
    if (format === 12) {
      const groups = cmap.readUInt32BE(sub + 12);
      for (let g = 0; g < groups; g += 1) {
        const start = cmap.readUInt32BE(sub + 16 + g * 12);
        const end = cmap.readUInt32BE(sub + 20 + g * 12);
        for (let c = start; c <= end; c += 1) codepoints.add(c);
      }
    } else if (format === 4) {
      const segments = cmap.readUInt16BE(sub + 6) / 2;
      for (let s = 0; s < segments; s += 1) {
        const end = cmap.readUInt16BE(sub + 14 + s * 2);
        const start = cmap.readUInt16BE(sub + 16 + segments * 2 + s * 2);
        for (let c = start; c <= end && c !== 0xffff; c += 1) codepoints.add(c);
      }
    }
  }
  return codepoints;
}

function fvarAxes(fvar: Buffer): Record<string, { min: number; max: number }> {
  const axesOffset = fvar.readUInt16BE(4);
  const axisCount = fvar.readUInt16BE(8);
  const axisSize = fvar.readUInt16BE(10);
  const axes: Record<string, { min: number; max: number }> = {};
  for (let i = 0; i < axisCount; i += 1) {
    const at = axesOffset + i * axisSize;
    axes[fvar.subarray(at, at + 4).toString('latin1')] = {
      min: fvar.readInt32BE(at + 4) / 65536,
      max: fvar.readInt32BE(at + 12) / 65536,
    };
  }
  return axes;
}

describe('font DM Sans — podzbiór łaciński (#388)', () => {
  const file = readFileSync(FONT);
  const tables = woff2Tables(file);

  it(`waży ≤ ${MAX_BYTES} B (oryginał TTF 240 164 B)`, () => {
    expect(file.length).toBeLessThanOrEqual(MAX_BYTES);
  });

  it('obsługuje znaki pl/nl/fr/en i interpunkcję z tekstów UI', () => {
    const codepoints = cmapCodepoints(tables.get('cmap')!);
    const required =
      'ąćęłńóśźżĄĆĘŁŃÓŚŹŻ' + // pl
      'éèêëàâçîïôûùœæÿÉÈÊÀÇŒ' + // fr
      'ĳĲüöäÜÖ' + // nl
      '„”“‘’–—…•«»€™→←−≥≤';
    const missing = [...required].filter((ch) => !codepoints.has(ch.codePointAt(0)!));
    expect(missing).toEqual([]);
  });

  it('pokrywa każdy znak z src/messages/*.json', () => {
    const codepoints = cmapCodepoints(tables.get('cmap')!);
    const missing = new Set<string>();
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const text = readFileSync(join(ROOT, 'src', 'messages', `${locale}.json`), 'utf-8');
      for (const ch of text) {
        if (!/\s/.test(ch) && !codepoints.has(ch.codePointAt(0)!)) missing.add(ch);
      }
    }
    expect([...missing]).toEqual([]);
  });

  it('nie zawiera cyrylicy, greki ani wietnamskich znaków rozszerzonych', () => {
    const codepoints = cmapCodepoints(tables.get('cmap')!);
    expect(codepoints.has(0x0416)).toBe(false); // Ж
    expect(codepoints.has(0x03a9)).toBe(false); // Ω
    expect(codepoints.has(0x1ea0)).toBe(false); // Ạ
  });

  it('ma oś wagi 400–800 (font-normal … 800 logo) i oś opsz 9–40', () => {
    const axes = fvarAxes(tables.get('fvar')!);
    expect(axes.wght).toEqual({ min: 400, max: 800 });
    expect(axes.opsz).toEqual({ min: 9, max: 40 });
  });

  it('fonts.ts wskazuje podzbiór, a przepis i oryginał są w repo', () => {
    const source = readFileSync(join(ROOT, 'src', 'app', 'fonts.ts'), 'utf-8');
    expect(source).toContain("src: './fonts/DMSans-latin.woff2'");
    expect(source).toContain("weight: '400 800'");
    expect(existsSync(join(ROOT, 'scripts', 'subset-font.py'))).toBe(true);
    expect(existsSync(join(ROOT, 'assets', 'fonts', 'DMSans-4.004[opsz,wght].ttf'))).toBe(true);
    expect(readFileSync(join(ROOT, 'assets', 'fonts', 'DMSans-OFL.txt'), 'utf-8')).toContain(
      'SIL OPEN FONT LICENSE Version 1.1',
    );
  });
});
