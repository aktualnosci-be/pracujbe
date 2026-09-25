/**
 * Reguły pliku CV kandydata — jedno źródło dla przeglądarki (`CvUpload`) i serwera
 * (`uploadCandidateCv`). Limit 5 MB leży poniżej limitu ciała Server Actions (`6mb`,
 * next.config.mjs): plik odrzucony tutaj nigdy nie jest wysyłany, więc strona nie trafia
 * na granicę błędu po 413 (#362).
 */

export const CV_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

/** Dozwolone typy MIME → rozszerzenie zapisywanego pliku. */
export const CV_ALLOWED_TYPES: ReadonlyMap<string, 'pdf' | 'doc' | 'docx'> = new Map([
  ['application/pdf', 'pdf'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
]);

/** Powód odrzucenia pliku (mapowany na komunikat i18n `files.error*`). */
export type CvFileProblem = 'empty' | 'tooLarge' | 'type';

/**
 * Kontrola metadanych pliku (bez czytania treści), identyczna z pierwszymi krokami serwera.
 * Serwer dodatkowo sprawdza sygnaturę zawartości (magic bytes) i strukturę DOCX.
 */
export function checkCvFile(file: { size: number; type: string }): CvFileProblem | null {
  if (file.size === 0) return 'empty';
  if (file.size > CV_MAX_BYTES) return 'tooLarge';
  return CV_ALLOWED_TYPES.has(file.type) ? null : 'type';
}

/**
 * Sygnatury (magic bytes) na format. MIME z klienta jest niezaufany. DOCX to kontener ZIP
 * (`PK`), stary DOC to OLE (`D0 CF 11 E0`). Wspólne dla uploadu CV i importu CV (#487).
 */
const CV_SIGNATURES: Record<'pdf' | 'doc' | 'docx', readonly number[][]> = {
  pdf: [[0x25, 0x50, 0x44, 0x46]], // %PDF
  docx: [[0x50, 0x4b]], // PK (zip)
  doc: [[0xd0, 0xcf, 0x11, 0xe0]], // OLE compound file
};

/** Czy początek pliku pasuje do sygnatury danego formatu. */
export function hasCvSignature(header: Uint8Array, ext: 'pdf' | 'doc' | 'docx'): boolean {
  return CV_SIGNATURES[ext].some(
    (sig) => sig.length <= header.length && sig.every((byte, i) => header[i] === byte),
  );
}
