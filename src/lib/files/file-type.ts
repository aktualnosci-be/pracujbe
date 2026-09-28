/**
 * Typ pliku wyznaczany z TREŚCI (CV i załączniki wiadomości) oraz nazwa pobieranego pliku
 * wynikająca z tego typu.
 *
 * Granica zaufania: MIME, nazwa i rozszerzenie z formularza są niezaufane. Serwer sprawdza
 * strukturę pliku (nie tylko pierwsze bajty), a nazwa w nagłówku pobrania i w wątku ma
 * rozszerzenie wynikające z typu potwierdzonego przy uploadzie (rozszerzenie klucza obiektu),
 * nigdy z nazwy od nadawcy. Moduł jest czysty (bez `server-only`), żeby dało się go testować.
 *
 * Reguły formatów:
 * - PDF: nagłówek `%PDF-` na początku i znacznik `%%EOF` w końcówce pliku.
 * - DOCX: poprawny kontener ZIP od pierwszego bajtu (nagłówek lokalny, rekord końca katalogu
 *   centralnego, spójny katalog centralny) z wpisami `[Content_Types].xml` i
 *   `word/document.xml`; bez projektu makr (`vbaProject.bin` — to już format `.docm`).
 * - DOC: plik złożony OLE (CFB) z poprawnym nagłówkiem, w którego katalogu jest strumień
 *   `WordDocument`; identyfikatory klas pakietów instalatora Windows są odrzucane.
 * - JPG/PNG: sygnatura formatu (bez zmian).
 */

export type DetectedExtension = 'pdf' | 'doc' | 'docx' | 'jpg' | 'png';

export const DETECTED_MIME: Record<DetectedExtension, string> = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  jpg: 'image/jpeg',
  png: 'image/png',
};

function u16(bytes: Uint8Array, offset: number): number {
  return bytes[offset]! | (bytes[offset + 1]! << 8);
}

function u32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! | (bytes[offset + 1]! << 8) | (bytes[offset + 2]! << 16) | (bytes[offset + 3]! << 24)) >>> 0;
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return offset + signature.length <= bytes.length && signature.every((byte, i) => bytes[offset + i] === byte);
}

// ---------------------------------------------------------------------------------------------
// PDF

const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PDF_EOF = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF
/** Czytniki szukają `%%EOF` w końcówce; dopuszczamy dopisane po nim białe znaki / aktualizacje. */
const PDF_TAIL_BYTES = 1024;

export function isPdf(bytes: Uint8Array): boolean {
  if (!startsWith(bytes, PDF_HEADER)) return false;
  const from = Math.max(PDF_HEADER.length, bytes.length - PDF_TAIL_BYTES);
  for (let i = bytes.length - PDF_EOF.length; i >= from; i -= 1) {
    if (startsWith(bytes, PDF_EOF, i)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// DOCX (ZIP / OOXML)

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_CENTRAL = [0x50, 0x4b, 0x01, 0x02];
const ZIP_EOCD = [0x50, 0x4b, 0x05, 0x06];
const ZIP_EOCD_SIZE = 22;
const ZIP_MAX_COMMENT = 0xffff;
const ZIP_MAX_ENTRIES = 10_000;

/** Nazwy wpisów z katalogu centralnego albo `null`, gdy struktura ZIP jest niepoprawna. */
export function zipEntryNames(bytes: Uint8Array): string[] | null {
  if (!startsWith(bytes, ZIP_LOCAL) || bytes.length < ZIP_EOCD_SIZE) return null;
  // Rekord końca katalogu: od końca, komentarz ≤ 64 KiB i musi sięgać dokładnie końca pliku.
  let eocd = -1;
  const lowest = Math.max(0, bytes.length - ZIP_EOCD_SIZE - ZIP_MAX_COMMENT);
  for (let i = bytes.length - ZIP_EOCD_SIZE; i >= lowest; i -= 1) {
    if (startsWith(bytes, ZIP_EOCD, i) && i + ZIP_EOCD_SIZE + u16(bytes, i + 20) === bytes.length) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  // Archiwa wieloczęściowe i ZIP64 (≥ 65535 wpisów / 4 GiB) nie są dokumentem 5 MB.
  if (u16(bytes, eocd + 4) !== 0 || u16(bytes, eocd + 6) !== 0) return null;
  const entriesOnDisk = u16(bytes, eocd + 8);
  const entries = u16(bytes, eocd + 10);
  const cdSize = u32(bytes, eocd + 12);
  const cdOffset = u32(bytes, eocd + 16);
  if (entries === 0 || entries !== entriesOnDisk || entries > ZIP_MAX_ENTRIES) return null;
  if (cdOffset + cdSize !== eocd) return null;

  const names: string[] = [];
  const decoder = new TextDecoder('utf-8', { fatal: false });
  let at = cdOffset;
  for (let n = 0; n < entries; n += 1) {
    if (at + 46 > eocd || !startsWith(bytes, ZIP_CENTRAL, at)) return null;
    const nameLength = u16(bytes, at + 28);
    const extraLength = u16(bytes, at + 30);
    const commentLength = u16(bytes, at + 32);
    const localOffset = u32(bytes, at + 42);
    const end = at + 46 + nameLength + extraLength + commentLength;
    if (nameLength === 0 || end > eocd) return null;
    // Każdy wpis katalogu musi wskazywać nagłówek lokalny przed katalogiem centralnym.
    if (localOffset + 30 > cdOffset || !startsWith(bytes, ZIP_LOCAL, localOffset)) return null;
    names.push(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)));
    at = end;
  }
  return at === eocd ? names : null;
}

export function isDocx(bytes: Uint8Array): boolean {
  const names = zipEntryNames(bytes);
  if (!names) return false;
  const lower = new Set(names.map((name) => name.toLowerCase()));
  if (!names.includes('[Content_Types].xml') || !lower.has('word/document.xml')) return false;
  return !names.some((name) => name.toLowerCase().endsWith('vbaproject.bin'));
}

// ---------------------------------------------------------------------------------------------
// DOC (OLE Compound File Binary)

const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const CFB_END_OF_CHAIN = 0xfffffffe;
const CFB_MAX_REGULAR = 0xfffffffa;
const CFB_HEADER_DIFAT = 109;
const CFB_DIR_ENTRY = 128;
/**
 * Identyfikatory klas pakietu instalatora Windows (MSI/MSP/MST) — takie pliki nie są dokumentem
 * Word, nawet jeśli zawierają strumień o nazwie `WordDocument`.
 */
const CFB_REJECTED_CLSIDS = new Set([
  '000c1084-0000-0000-c000-000000000046',
  '000c1086-0000-0000-c000-000000000046',
  '000c1082-0000-0000-c000-000000000046',
]);

function clsid(bytes: Uint8Array, offset: number): string {
  const hex = (from: number, to: number, reverse: boolean) => {
    const part = Array.from(bytes.subarray(from, to), (b) => b.toString(16).padStart(2, '0'));
    return (reverse ? part.reverse() : part).join('');
  };
  return [
    hex(offset, offset + 4, true),
    hex(offset + 4, offset + 6, true),
    hex(offset + 6, offset + 8, true),
    hex(offset + 8, offset + 10, false),
    hex(offset + 10, offset + 16, false),
  ].join('-');
}

function cfbDirectoryEntries(bytes: Uint8Array): Array<{ name: string; type: number; clsid: string }> | null {
  if (bytes.length < 512 || !startsWith(bytes, CFB_SIGNATURE)) return null;
  if (u16(bytes, 0x1c) !== 0xfffe) return null; // kolejność bajtów
  const major = u16(bytes, 0x1a);
  const shift = u16(bytes, 0x1e);
  if (!((major === 3 && shift === 9) || (major === 4 && shift === 12))) return null;
  const sectorSize = 1 << shift;
  // Ostatni sektor bywa przycięty przez część programów — liczymy go, czytamy tylko pełne dane.
  const sectorCount = Math.ceil((bytes.length - sectorSize) / sectorSize);
  if (sectorCount < 1) return null;
  const sectorOffset = (sector: number) => (sector + 1) * sectorSize;
  const sectorEnd = (sector: number) => Math.min(sectorOffset(sector) + sectorSize, bytes.length);
  const validSector = (sector: number) =>
    Number.isInteger(sector) && sector >= 0 && sector <= CFB_MAX_REGULAR && sector < sectorCount;

  // Sektory FAT z tablicy DIFAT w nagłówku i (dla dużych plików) z łańcucha DIFAT.
  const fatSectorsDeclared = u32(bytes, 0x2c);
  if (fatSectorsDeclared === 0 || fatSectorsDeclared > sectorCount) return null;
  const fatSectors: number[] = [];
  for (let i = 0; i < CFB_HEADER_DIFAT && fatSectors.length < fatSectorsDeclared; i += 1) {
    fatSectors.push(u32(bytes, 0x4c + i * 4));
  }
  let difat = u32(bytes, 0x44);
  const perDifat = sectorSize / 4 - 1;
  for (let guard = 0; fatSectors.length < fatSectorsDeclared; guard += 1) {
    if (!validSector(difat) || guard > sectorCount) return null;
    const base = sectorOffset(difat);
    if (sectorEnd(difat) !== base + sectorSize) return null;
    for (let i = 0; i < perDifat && fatSectors.length < fatSectorsDeclared; i += 1) {
      fatSectors.push(u32(bytes, base + i * 4));
    }
    difat = u32(bytes, base + perDifat * 4);
  }
  if (fatSectors.some((sector) => !validSector(sector))) return null;
  const FREE = 0xffffffff;
  const next = (sector: number): number => {
    const index = sector * 4;
    const fatSector = fatSectors[Math.floor(index / sectorSize)];
    if (fatSector === undefined) return FREE;
    const at = sectorOffset(fatSector) + (index % sectorSize);
    return at + 4 <= bytes.length ? u32(bytes, at) : FREE;
  };

  // Łańcuch katalogu — bez pętli i bez wyjścia poza plik.
  const entries: Array<{ name: string; type: number; clsid: string }> = [];
  const seen = new Set<number>();
  let sector = u32(bytes, 0x30);
  while (sector !== CFB_END_OF_CHAIN) {
    if (!validSector(sector) || seen.has(sector)) return null;
    seen.add(sector);
    const base = sectorOffset(sector);
    for (let at = base; at + CFB_DIR_ENTRY <= sectorEnd(sector); at += CFB_DIR_ENTRY) {
      const nameBytes = u16(bytes, at + 0x40);
      const type = bytes[at + 0x42]!;
      if (type === 0) continue; // wolny wpis
      if (nameBytes < 2 || nameBytes > 64 || nameBytes % 2 !== 0) return null;
      let name = '';
      for (let i = 0; i < nameBytes - 2; i += 2) name += String.fromCharCode(u16(bytes, at + i));
      entries.push({ name, type, clsid: clsid(bytes, at + 0x50) });
    }
    sector = next(sector);
  }
  return entries;
}

export function isWordDoc(bytes: Uint8Array): boolean {
  const entries = cfbDirectoryEntries(bytes);
  const root = entries?.[0];
  if (!entries || !root || root.type !== 5) return false;
  if (CFB_REJECTED_CLSIDS.has(root.clsid)) return false;
  return entries.some((entry) => entry.type === 2 && entry.name.toLowerCase() === 'worddocument');
}

// ---------------------------------------------------------------------------------------------
// Obrazy

export function isJpeg(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0xff, 0xd8, 0xff]);
}

export function isPng(bytes: Uint8Array): boolean {
  return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
}

const CHECKS: Record<DetectedExtension, (bytes: Uint8Array) => boolean> = {
  pdf: isPdf,
  doc: isWordDoc,
  docx: isDocx,
  jpg: isJpeg,
  png: isPng,
};

/** Czy treść jest plikiem danego typu. */
export function matchesDetectedType(bytes: Uint8Array, ext: DetectedExtension): boolean {
  return CHECKS[ext](bytes);
}

/** Typ wyznaczony z treści spośród dozwolonych albo `null`. */
export function detectFileType(
  bytes: Uint8Array,
  allowed: readonly DetectedExtension[],
): DetectedExtension | null {
  return allowed.find((ext) => CHECKS[ext](bytes)) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Nazwa pliku

/**
 * Znaki usuwane z nazwy: sterujące (Cc), formatujące i sterujące kierunkiem tekstu (Cf —
 * m.in. U+200E/F, U+202A–U+202E, U+2066–U+2069, U+FEFF), separatory wiersza/akapitu oraz
 * znaki niedozwolone w nazwach plików Windows i separatory ścieżek.
 */
const STRIP = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;
const REPLACE = /[\\/:*?"<>|]/g;
const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;
const BASE_MAX = 150;
const EXTENSION_ALIASES: Record<DetectedExtension, readonly string[]> = {
  pdf: ['pdf'],
  doc: ['doc'],
  docx: ['docx'],
  jpg: ['jpg', 'jpeg'],
  png: ['png'],
};

/**
 * Nazwa pliku do pokazania i do nagłówka pobrania: oczyszczona podstawa nazwy od nadawcy
 * (bez znaków sterujących/kierunku, bez ścieżki, bez ostatniego rozszerzenia) + rozszerzenie
 * wynikające z typu wyznaczonego z treści. Pusta podstawa → `fallbackBase`.
 */
export function safeFileName(name: string, ext: DetectedExtension, fallbackBase: string): string {
  let base = name.normalize('NFC').replace(STRIP, '').replace(REPLACE, '_');
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot);
  // „CV.pdf” z typem PDF → „CV”, a nie „CV.pdf.pdf”.
  for (const alias of EXTENSION_ALIASES[ext]) {
    if (base.toLowerCase().endsWith(`.${alias}`)) base = base.slice(0, -(alias.length + 1));
  }
  base = Array.from(base.trim()).slice(0, BASE_MAX).join('');
  base = base.replace(/^[\s.]+|[\s.]+$/g, '');
  if (!base) base = fallbackBase;
  if (RESERVED.test(base)) base = `_${base}`;
  return `${base}.${ext}`;
}

/** Rozszerzenie klucza obiektu nadanego przez serwer (`…/cv-<uuid>.pdf`, `…/att-<uuid>.png`). */
export function extensionOfKey(key: string): DetectedExtension | null {
  const ext = key.slice(key.lastIndexOf('.') + 1);
  return ext in DETECTED_MIME ? (ext as DetectedExtension) : null;
}

/** Rozszerzenie odpowiadające MIME zapisanemu w bazie (dla nazw wyświetlanych z wierszy). */
export function extensionOfMime(mime: string): DetectedExtension | null {
  const found = (Object.keys(DETECTED_MIME) as DetectedExtension[]).find((ext) => DETECTED_MIME[ext] === mime);
  return found ?? null;
}
