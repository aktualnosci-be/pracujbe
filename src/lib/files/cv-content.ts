/**
 * Walidacja TREŚCI pliku CV na serwerze (#26, wcześniej w `actions/files.ts`). MIME z klienta
 * jest niezaufany: sprawdzamy sygnaturę (magic bytes) na tych samych bajtach, które trafią do
 * bucketu. DOCX musi być kontenerem OOXML (P1-22), nie dowolnym ZIP-em.
 * AV/CDR = osobny etap (skaner zewnętrzny); do tego czasu `scan_status='skipped'`.
 */

export type CvExtension = 'pdf' | 'doc' | 'docx';

const SIGNATURES: Record<CvExtension, readonly (readonly number[])[]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  docx: [[0x50, 0x4b]], // PK (zip)
  doc: [[0xd0, 0xcf, 0x11, 0xe0]], // OLE compound file
};

export function hasValidCvSignature(bytes: Uint8Array, ext: CvExtension): boolean {
  return SIGNATURES[ext].some(
    (sig) => sig.length <= bytes.length && sig.every((byte, i) => bytes[i] === byte),
  );
}

/** Nazwy wpisów są w nagłówkach lokalnych ZIP jako tekst — skan bufora (latin1) je wykrywa. */
export function isOoxmlDocx(bytes: Uint8Array): boolean {
  const text = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('latin1');
  return text.includes('[Content_Types].xml') && text.includes('word/');
}

export function isValidCvContent(bytes: Uint8Array, ext: CvExtension): boolean {
  if (!hasValidCvSignature(bytes, ext)) return false;
  return ext !== 'docx' || isOoxmlDocx(bytes);
}

/**
 * Nazwa pokazywana kandydatowi i używana w nagłówku pobrania. Bez znaków sterujących,
 * maks. 200 znaków (kodowych), pusta → `CV.<ext>`. Nie wpływa na klucz obiektu.
 */
export function cvDisplayName(name: string, ext: CvExtension): string {
  const cleaned = Array.from(name.replace(/[\x00-\x1f\x7f]/g, '').trim()).slice(0, 200).join('').trim();
  return cleaned || `CV.${ext}`;
}

/** `Content-Disposition: attachment` z bezpiecznym fallbackiem ASCII i nazwą UTF-8 (RFC 6266/5987). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'cv';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
