/**
 * Walidacja obrazu importowanego ogłoszenia (#465) — jedno źródło dla przeglądarki i serwera.
 * Metadane (rozmiar, deklarowany typ) sprawdza też przeglądarka; serwer dodatkowo porównuje
 * sygnaturę zawartości (magic bytes), bo nagłówek `type` pochodzi od klienta.
 *
 * Limit 5 MB leży poniżej limitu ciała Server Actions (`6mb`, next.config.mjs) i poniżej
 * limitu żądania OpenAI Responses API (512 MB), więc plik odrzucony tutaj nigdy nie jest wysyłany dalej.
 */

export const IMPORT_IMAGE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB

export type ImportImageType = 'image/png' | 'image/jpeg' | 'image/webp';

export const IMPORT_IMAGE_TYPES: readonly ImportImageType[] = ['image/png', 'image/jpeg', 'image/webp'];

/** Powód odrzucenia pliku (mapowany na komunikat `jobImport.error*`). */
export type ImportImageProblem = 'empty' | 'tooLarge' | 'type';

/** Kontrola metadanych pliku (bez czytania treści). */
export function checkImportImageMeta(file: { size: number; type: string }): ImportImageProblem | null {
  if (file.size === 0) return 'empty';
  if (file.size > IMPORT_IMAGE_MAX_BYTES) return 'tooLarge';
  return (IMPORT_IMAGE_TYPES as readonly string[]).includes(file.type) ? null : 'type';
}

/** Rozpoznaje typ obrazu po sygnaturze zawartości; `null` = nieobsługiwany/podrobiony plik. */
export function sniffImageType(bytes: Uint8Array): ImportImageType | null {
  const b = bytes;
  if (
    b.length >= 8 &&
    b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
    b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a
  ) {
    return 'image/png';
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && // RIFF
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  return null;
}

/**
 * Pełna kontrola serwerowa: metadane + sygnatura zgodna z deklarowanym typem. Zwraca
 * rozpoznany typ albo powód odrzucenia.
 */
export function checkImportImageBytes(
  bytes: Uint8Array,
  declaredType: string,
): { ok: true; type: ImportImageType } | { ok: false; problem: ImportImageProblem } {
  const meta = checkImportImageMeta({ size: bytes.byteLength, type: declaredType });
  if (meta) return { ok: false, problem: meta };
  const sniffed = sniffImageType(bytes);
  if (!sniffed || sniffed !== declaredType) return { ok: false, problem: 'type' };
  return { ok: true, type: sniffed };
}
