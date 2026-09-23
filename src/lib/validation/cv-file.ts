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
