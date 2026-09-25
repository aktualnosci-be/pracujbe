import 'server-only';

import { inflateRawSync } from 'node:zlib';

import { CV_ALLOWED_TYPES, CV_MAX_BYTES, hasCvSignature } from '@/lib/validation/cv-file';

/**
 * Lokalne wyciągnięcie tekstu z CV (#487) — bez usług zewnętrznych, w pamięci żądania.
 *
 *   - PDF: pdf.js 5 (`unpdf`, build serwerowy — bez `eval`/`new Function`, więc bez
 *     klasy CVE-2024-4367), bez XFA, fontów systemowych i sieci; najwyżej
 *     `CV_TEXT_MAX_PAGES` stron i łączny limit czasu. Obrazy (skany) są ignorowane —
 *     skan bez warstwy tekstu = `noText` (brak lokalnego OCR, więc nie wysyłamy obrazu).
 *   - DOCX: własny odczyt kontenera ZIP (tylko `word/document.xml`; nagłówki/stopki, które
 *     zwykle zawierają dane kontaktowe, pomijamy), z limitem rozmiaru po dekompresji
 *     (ochrona przed „zip bomb”).
 *   - DOC (OLE) nie jest obsługiwany w imporcie — kandydat może użyć PDF/DOCX albo
 *     wypełnić profil ręcznie.
 *
 * Pliku ani tekstu NIE zapisujemy, nie logujemy i nie przekazujemy do telemetrii.
 */

export const CV_TEXT_MAX_PAGES = 10;
export const CV_TEXT_MAX_CHARS = 30_000;
const DOCX_XML_MAX_BYTES = 4 * 1024 * 1024;
const PARSE_TIMEOUT_MS = 10_000;

export type CvTextProblem = 'empty' | 'tooLarge' | 'type' | 'unsupported' | 'noText' | 'unreadable';

export type CvTextResult = { ok: true; text: string } | { ok: false; problem: CvTextProblem };

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e: unknown) => {
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error('parse'));
      },
    );
  });
}

/* ---------------------------------------------------------------------------
 * PDF
 * ------------------------------------------------------------------------- */

interface PdfTextItem {
  str?: string;
  hasEOL?: boolean;
  transform?: number[];
}

async function pdfText(bytes: Uint8Array): Promise<string> {
  const { getDocumentProxy } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(bytes), {
    disableFontFace: true,
    enableXfa: false,
    // Bez ostrzeżeń parsera w logach serwera (mogą dotyczyć treści dokumentu).
    verbosity: 0,
    useSystemFonts: false,
    stopAtErrors: false,
  });
  try {
    const pages = Math.min(doc.numPages, CV_TEXT_MAX_PAGES);
    let out = '';
    for (let n = 1; n <= pages && out.length < CV_TEXT_MAX_CHARS; n++) {
      const page = await doc.getPage(n);
      const content = await page.getTextContent();
      let lastY: number | null = null;
      for (const raw of content.items as PdfTextItem[]) {
        if (typeof raw.str !== 'string') continue;
        const y = Array.isArray(raw.transform) ? raw.transform[5] ?? null : null;
        // Nowa linia przy zmianie współrzędnej Y (pdf.js nie zawsze ustawia hasEOL).
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2 && !out.endsWith('\n')) out += '\n';
        out += raw.str;
        if (raw.hasEOL) out += '\n';
        if (y !== null) lastY = y;
      }
      out += '\n\n';
    }
    return out;
  } finally {
    await doc.loadingTask.destroy();
  }
}

/* ---------------------------------------------------------------------------
 * DOCX — minimalny czytnik ZIP (central directory → wpis `word/document.xml`)
 * ------------------------------------------------------------------------- */

function readDocxEntry(buf: Buffer, wanted: string): Buffer | null {
  // End of central directory: sygnatura 0x06054b50, szukana od końca (komentarz ≤ 64 KB).
  const minEocd = Math.max(0, buf.length - 22 - 0xffff);
  let eocd = -1;
  for (let i = buf.length - 22; i >= minEocd; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const entries = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let e = 0; e < entries && p + 46 <= buf.length; e++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20);
    const size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;
    if (name !== wanted) continue;
    if (size > DOCX_XML_MAX_BYTES) return null;
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) return null;
    const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const data = buf.subarray(start, start + compressed);
    if (data.length !== compressed) return null;
    if (method === 0) return data;
    if (method !== 8) return null;
    // Limit wyjścia niezależny od zadeklarowanego rozmiaru (nagłówek jest niezaufany).
    return inflateRawSync(data, { maxOutputLength: DOCX_XML_MAX_BYTES });
  }
  return null;
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

function decodeXml(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return XML_ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Tekst `word/document.xml`: akapit = linia, `<w:tab/>` = tabulator, `<w:br/>` = nowa linia. */
export function docxXmlToText(xml: string): string {
  let out = '';
  const token = /<w:t(?:\s[^>]*[^/>])?>([^<]*)<\/w:t>|<w:(?:tab|ptab)\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>|<\/w:p>/g;
  for (const m of xml.matchAll(token)) {
    if (m[1] !== undefined) out += decodeXml(m[1]);
    else if (m[0].startsWith('<w:tab') || m[0].startsWith('<w:ptab')) out += '\t';
    else out += '\n';
  }
  return out;
}

async function docxText(bytes: Uint8Array): Promise<string | null> {
  const xml = readDocxEntry(Buffer.from(bytes), 'word/document.xml');
  return xml ? docxXmlToText(xml.toString('utf8')) : null;
}

/* ---------------------------------------------------------------------------
 * Wejście
 * ------------------------------------------------------------------------- */

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, CV_TEXT_MAX_CHARS);
}

/**
 * Plik CV → tekst. Typ po deklarowanym MIME ORAZ sygnaturze zawartości; błędy parsera
 * (uszkodzony plik, przekroczony czas) → `unreadable`, bez szczegółów dla użytkownika.
 */
export async function extractCvText(bytes: Uint8Array, declaredType: string): Promise<CvTextResult> {
  if (bytes.byteLength === 0) return { ok: false, problem: 'empty' };
  if (bytes.byteLength > CV_MAX_BYTES) return { ok: false, problem: 'tooLarge' };
  const ext = CV_ALLOWED_TYPES.get(declaredType);
  if (!ext || !hasCvSignature(bytes.subarray(0, 8), ext)) return { ok: false, problem: 'type' };
  if (ext === 'doc') return { ok: false, problem: 'unsupported' };

  let raw: string | null;
  try {
    raw = await withTimeout(ext === 'pdf' ? pdfText(bytes) : docxText(bytes), PARSE_TIMEOUT_MS);
  } catch {
    return { ok: false, problem: 'unreadable' };
  }
  if (raw === null) return { ok: false, problem: 'unreadable' };
  const text = normalize(raw);
  // Skan bez warstwy tekstu albo pusty dokument.
  if (text.replace(/\s/g, '').length < 40) return { ok: false, problem: 'noText' };
  return { ok: true, text };
}
