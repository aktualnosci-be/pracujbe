/**
 * Reguły załącznika wiadomości — jedno źródło dla przeglądarki (`MessageComposer`) i serwera
 * (`uploadMessageAttachment`). Limit i typy dokumentów jak CV (`cv-file.ts`, #362) plus
 * zdjęcia JPG/PNG; 5 MB leży poniżej limitu ciała Server Actions (`6mb`). Serwer dodatkowo
 * sprawdza sygnaturę treści (magic bytes) i strukturę DOCX, a baza (0119) — MIME, rozmiar
 * i klucz obiektu.
 */

import { CV_MAX_BYTES, type CvFileProblem } from './cv-file';

export const ATTACHMENT_MAX_BYTES = CV_MAX_BYTES; // 5 MB

/** Najwięcej plików w jednej wiadomości (= limit w `send_message`, 0119). */
export const MESSAGE_ATTACHMENTS_MAX = 3;

export type AttachmentExtension = 'pdf' | 'doc' | 'docx' | 'jpg' | 'png';

/** Dozwolone typy MIME → rozszerzenie zapisywanego obiektu. */
export const ATTACHMENT_ALLOWED_TYPES: ReadonlyMap<string, AttachmentExtension> = new Map([
  ['application/pdf', 'pdf'],
  ['application/msword', 'doc'],
  ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'docx'],
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
]);

/** Atrybut `accept` pola pliku. */
export const ATTACHMENT_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png';

/** Powód odrzucenia (te same klucze co CV: `files.error*`). */
export type AttachmentFileProblem = CvFileProblem;

export function checkAttachmentFile(file: { size: number; type: string }): AttachmentFileProblem | null {
  if (file.size === 0) return 'empty';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'tooLarge';
  return ATTACHMENT_ALLOWED_TYPES.has(file.type) ? null : 'type';
}
