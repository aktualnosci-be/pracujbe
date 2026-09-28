// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { attachmentDisposition, cvDisplayName, isValidCvContent } from '@/lib/files/cv-content';
import {
  detectFileType,
  extensionOfKey,
  extensionOfMime,
  isDocx,
  isPdf,
  isWordDoc,
  safeFileName,
  zipEntryNames,
} from '@/lib/files/file-type';
import { buildDocx, buildPdf, buildZip } from '../helpers/cv-fixtures';
import { buildCfb, MSI_CLSID } from '../helpers/cfb-fixtures';

/**
 * Typ pobieranego pliku wyznaczany z treści, a nazwa w nagłówku pobrania = oczyszczona
 * podstawa + rozszerzenie z tego typu. Kontrole ujemne: `legacy*` to reguły sprzed zmiany —
 * przepuszczały te same próbki, które nowa walidacja odrzuca.
 */

const enc = (s: string) => new TextEncoder().encode(s);
const ALL = ['pdf', 'doc', 'docx', 'jpg', 'png'] as const;

/** Reguły sprzed zmiany (kontrola ujemna). */
const legacySignature = (bytes: Uint8Array, sig: number[]) => sig.every((b, i) => bytes[i] === b);
const legacyDocx = (bytes: Uint8Array) => {
  const text = Buffer.from(bytes).toString('latin1');
  return legacySignature(bytes, [0x50, 0x4b]) && text.includes('[Content_Types].xml') && text.includes('word/');
};
const legacyName = (name: string) => name.replace(/[\x00-\x1f\x7f]/g, '').trim();

describe('PDF: nagłówek i znacznik końca', () => {
  it('poprawny PDF przechodzi', () => {
    expect(isPdf(buildPdf(['Jan Testowy']))).toBe(true);
    expect(isValidCvContent(buildPdf(['x']), 'pdf')).toBe(true);
  });

  it('sam nagłówek z dowolnym ogonem jest odrzucany (kontrola ujemna: dawna reguła przepuszczała)', () => {
    const tail = enc('%PDF-1.7\n@echo off\r\nexit\r\n');
    expect(legacySignature(tail, [0x25, 0x50, 0x44, 0x46])).toBe(true);
    expect(isPdf(tail)).toBe(false);
    expect(isPdf(enc('%PDF'))).toBe(false);
    expect(isPdf(enc('xx%PDF-1.7\n%%EOF'))).toBe(false);
  });

  it('%%EOF musi być w końcówce pliku, nie tylko gdzieś w środku', () => {
    const bytes = Buffer.concat([buildPdf(['x']), Buffer.alloc(4096, 0x41)]);
    expect(isPdf(bytes)).toBe(false);
  });
});

describe('DOCX: spójny ZIP z wpisami OOXML', () => {
  it('dokument OOXML przechodzi', () => {
    const docx = buildDocx('Jan Testowy');
    expect(isDocx(docx)).toBe(true);
    expect(zipEntryNames(docx)).toContain('word/document.xml');
    expect(detectFileType(docx, ALL)).toBe('docx');
  });

  it('fałszywy ZIP z samymi napisami odrzucony (kontrola ujemna: dawna reguła przepuszczała)', () => {
    const fake = enc('PK\x03\x04 [Content_Types].xml word/document.xml payload');
    expect(legacyDocx(fake)).toBe(true);
    expect(isDocx(fake)).toBe(false);
    expect(isValidCvContent(fake, 'docx')).toBe(false);
  });

  it('dane dopisane przed archiwum, brak word/document.xml albo projekt makr → odrzucone', () => {
    const docx = buildDocx('x');
    const prefixed = Buffer.concat([enc('MZ\x90\x00'), docx]);
    expect(isDocx(prefixed)).toBe(false);
    expect(isDocx(Buffer.concat([docx, enc('trailing')]))).toBe(false);
    expect(isDocx(buildZip({ '[Content_Types].xml': '<Types/>', 'word/other.xml': '<x/>' }))).toBe(false);
    expect(isDocx(buildZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': '<w/>', 'word/vbaProject.bin': 'x' })))
      .toBe(false);
    expect(isDocx(buildZip({ 'a.txt': 'x' }))).toBe(false);
  });

  it('uszkodzony katalog centralny → odrzucone', () => {
    const docx = Buffer.from(buildDocx('x'));
    const eocd = docx.length - 22;
    const broken = Buffer.from(docx);
    broken.writeUInt32LE(docx.readUInt32LE(eocd + 16) + 1, eocd + 16);
    expect(isDocx(broken)).toBe(false);
  });
});

describe('DOC: plik OLE ze strumieniem WordDocument', () => {
  it('dokument Word 97–2003 przechodzi', () => {
    expect(isWordDoc(buildCfb())).toBe(true);
    expect(detectFileType(buildCfb(), ALL)).toBe('doc');
  });

  it('pakiet instalatora jako .doc odrzucony (kontrola ujemna: dawna reguła przepuszczała)', () => {
    const msi = buildCfb({ rootClsid: MSI_CLSID, streams: ['\u4840\u3f3f\u4577'] });
    expect(legacySignature(msi, [0xd0, 0xcf, 0x11, 0xe0])).toBe(true);
    expect(isWordDoc(msi)).toBe(false);
    expect(isValidCvContent(msi, 'doc')).toBe(false);
    // Nawet ze strumieniem o nazwie WordDocument identyfikator klasy instalatora = odmowa.
    expect(isWordDoc(buildCfb({ rootClsid: MSI_CLSID }))).toBe(false);
  });

  it('inny plik OLE (bez WordDocument), sam nagłówek i zapętlony katalog → odrzucone', () => {
    expect(isWordDoc(buildCfb({ streams: ['Workbook'] }))).toBe(false);
    expect(isWordDoc(buildCfb().subarray(0, 512))).toBe(false);
    expect(isWordDoc(Uint8Array.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))).toBe(false);
    expect(isWordDoc(buildCfb({ loopDirectory: true }))).toBe(false);
  });
});

describe('nazwa pobieranego pliku', () => {
  it('rozszerzenie z wykrytego typu, nie z nazwy od nadawcy', () => {
    expect(legacyName('Umowa_o_prace.msi')).toBe('Umowa_o_prace.msi');
    expect(safeFileName('Umowa_o_prace.msi', 'doc', 'file')).toBe('Umowa_o_prace.doc');
    expect(safeFileName('CV.pdf.bat', 'pdf', 'file')).toBe('CV.pdf');
    expect(safeFileName('CV.pdf', 'pdf', 'file')).toBe('CV.pdf');
    expect(safeFileName('zdjęcie.JPEG', 'jpg', 'file')).toBe('zdjęcie.jpg');
    expect(safeFileName('bez rozszerzenia', 'png', 'file')).toBe('bez rozszerzenia.png');
  });

  it('znaki sterujące kierunkiem tekstu usunięte (kontrola ujemna: dawna reguła je zostawiała)', () => {
    const name = 'Faktura\u202Efdp.exe';
    expect(legacyName(name)).toContain('\u202E');
    const safe = safeFileName(name, 'pdf', 'file');
    expect(safe).toBe('Fakturafdp.pdf');
    for (const ch of ['\u200E', '\u200F', '\u202A', '\u202B', '\u202C', '\u202D', '\u2066', '\u2067', '\u2068', '\u2069', '\uFEFF', '\u2028']) {
      expect(safeFileName(`a${ch}b.pdf`, 'pdf', 'file')).toBe('ab.pdf');
    }
    expect(attachmentDisposition(safe)).not.toMatch(/%E2%80%AE/i);
  });

  it('bez ścieżek, nazw zarezerwowanych i pustej podstawy', () => {
    const traversal = safeFileName('../../etc/passwd.exe', 'pdf', 'file');
    expect(traversal).not.toMatch(/[\\/]/);
    expect(traversal.endsWith('.pdf')).toBe(true);
    expect(safeFileName('C:\\temp\\x.exe', 'doc', 'file')).not.toMatch(/[\\/:]/);
    expect(safeFileName('CON.pdf', 'pdf', 'file')).toBe('_CON.pdf');
    expect(safeFileName('\u202E', 'png', 'file')).toBe('file.png');
    expect(safeFileName('\u202E.exe', 'png', 'file')).toBe('exe.png');
    expect(safeFileName('   ', 'docx', 'CV')).toBe('CV.docx');
    expect(cvDisplayName('...', 'doc')).toBe('CV.doc');
    expect(Array.from(safeFileName('a'.repeat(400), 'pdf', 'file'))).toHaveLength(154);
  });

  it('rozszerzenie z klucza obiektu i z MIME', () => {
    expect(extensionOfKey('11111111-1111-4111-8111-111111111111/att-x.docx')).toBe('docx');
    expect(extensionOfKey('a/cv-x.exe')).toBeNull();
    expect(extensionOfMime('application/msword')).toBe('doc');
    expect(extensionOfMime('application/x-msdownload')).toBeNull();
  });
});
