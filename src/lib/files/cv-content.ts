/**
 * Walidacja TREŚCI pliku CV na serwerze (#26, wcześniej w `actions/files.ts`). MIME z klienta
 * jest niezaufany: sprawdzamy sygnaturę (magic bytes) na tych samych bajtach, które trafią do
 * bucketu. DOCX musi być kontenerem OOXML (P1-22), nie dowolnym ZIP-em; reguły formatów
 * i nazwy pobieranego pliku są w `file-type.ts`.
 * AV/CDR = osobny etap (skaner zewnętrzny); do tego czasu `scan_status='skipped'`.
 */

import { matchesDetectedType, safeFileName } from './file-type';

export type CvExtension = 'pdf' | 'doc' | 'docx';

/**
 * Czy treść jest plikiem danego typu — pełna kontrola struktury (`file-type.ts`): PDF z
 * `%%EOF`, DOCX jako spójny ZIP z `word/document.xml`, DOC jako plik OLE ze strumieniem
 * `WordDocument` (inne pliki OLE, np. instalatory, są odrzucane).
 */
export function isValidCvContent(bytes: Uint8Array, ext: CvExtension): boolean {
  return matchesDetectedType(bytes, ext);
}

/**
 * Nazwa pokazywana kandydatowi i używana w nagłówku pobrania: oczyszczona podstawa nazwy
 * (bez znaków sterujących i kierunku tekstu, bez ścieżki) + rozszerzenie z typu wyznaczonego
 * z treści; ≤ 150 znaków podstawy, pusta → `CV.<ext>`. Nie wpływa na klucz obiektu.
 */
export function cvDisplayName(name: string, ext: CvExtension): string {
  return safeFileName(name, ext, 'CV');
}

/** `Content-Disposition: attachment` z bezpiecznym fallbackiem ASCII i nazwą UTF-8 (RFC 6266/5987). */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 200) || 'cv';
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (c) =>
    `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
