import { describe, expect, it } from 'vitest';

import {
  checkImportImageBytes,
  checkImportImageMeta,
  IMPORT_IMAGE_MAX_BYTES,
  sniffImageType,
} from '@/lib/ai-import/image';

/** #465 — obraz ogłoszenia: typ po sygnaturze zawartości, nie po deklaracji klienta. */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj');
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const GIF = new TextEncoder().encode('GIF89a......');

describe('sniffImageType', () => {
  it('rozpoznaje PNG, JPEG i WebP', () => {
    expect(sniffImageType(PNG)).toBe('image/png');
    expect(sniffImageType(JPEG)).toBe('image/jpeg');
    expect(sniffImageType(WEBP)).toBe('image/webp');
  });

  it('odrzuca PDF, SVG, GIF i pusty plik', () => {
    expect(sniffImageType(PDF)).toBeNull();
    expect(sniffImageType(SVG)).toBeNull();
    expect(sniffImageType(GIF)).toBeNull();
    expect(sniffImageType(new Uint8Array())).toBeNull();
  });
});

describe('checkImportImageBytes', () => {
  it('przyjmuje obraz zgodny z deklarowanym typem', () => {
    expect(checkImportImageBytes(PNG, 'image/png')).toEqual({ ok: true, type: 'image/png' });
    expect(checkImportImageBytes(WEBP, 'image/webp')).toEqual({ ok: true, type: 'image/webp' });
  });

  it('kontrola ujemna: podrobiony typ (PDF/SVG jako PNG) jest odrzucany', () => {
    expect(checkImportImageBytes(PDF, 'image/png')).toEqual({ ok: false, problem: 'type' });
    expect(checkImportImageBytes(SVG, 'image/png')).toEqual({ ok: false, problem: 'type' });
    // Prawdziwy JPEG zadeklarowany jako PNG też nie przechodzi (niespójne metadane).
    expect(checkImportImageBytes(JPEG, 'image/png')).toEqual({ ok: false, problem: 'type' });
  });

  it('odrzuca niedozwolony typ, pusty i za duży plik', () => {
    expect(checkImportImageBytes(SVG, 'image/svg+xml')).toEqual({ ok: false, problem: 'type' });
    expect(checkImportImageBytes(new Uint8Array(), 'image/png')).toEqual({ ok: false, problem: 'empty' });
    const big = new Uint8Array(IMPORT_IMAGE_MAX_BYTES + 1);
    big.set(PNG);
    expect(checkImportImageBytes(big, 'image/png')).toEqual({ ok: false, problem: 'tooLarge' });
  });

  it('metadane w przeglądarce: te same reguły rozmiaru i typu', () => {
    expect(checkImportImageMeta({ size: 10, type: 'image/jpeg' })).toBeNull();
    expect(checkImportImageMeta({ size: 10, type: 'application/pdf' })).toBe('type');
    expect(checkImportImageMeta({ size: IMPORT_IMAGE_MAX_BYTES + 1, type: 'image/png' })).toBe('tooLarge');
  });
});
