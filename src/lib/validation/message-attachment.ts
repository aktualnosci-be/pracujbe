/**
 * Reguły załącznika wiadomości — jedno źródło dla przeglądarki (`MessageComposer`) i serwera
 * (`uploadMessageAttachment`). Limit i typy dokumentów jak CV (`cv-file.ts`, #362) plus
 * zdjęcia JPG/PNG; 5 MB leży poniżej limitu ciała Server Actions (`6mb`). Serwer dodatkowo
 * sprawdza sygnaturę treści (magic bytes) i strukturę DOCX, a baza (0119) — MIME, rozmiar
 * i klucz obiektu. Nazwa pliku z numerem NISS/BIS, PESEL, eID albo „paszport nr…” jest
 * odrzucana przed wysyłką do bucketu (#495) — ta sama reguła w przeglądarce i w akcji.
 */

import { containsPersonalIdentifier } from '@/lib/privacy/sensitive-data';

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

/**
 * Powód odrzucenia: te same co CV (`files.error*`) oraz `sensitiveId` — nazwa pliku zawiera
 * numer NISS/BIS, PESEL, eID albo numer dokumentu (#495; komunikat `messages.attachmentSensitiveId`).
 */
export type AttachmentFileProblem = CvFileProblem | 'sensitiveId';

/**
 * Nazwa pliku w postaci do detektora `sensitive-data.ts`: bez rozszerzenia, a `_`/`+` (typowe
 * separatory w nazwach plików, np. `paszport_nr_AB1234567.pdf`) zamienione na spacje — inaczej
 * słowo kluczowe i numer nie byłyby osobnymi tokenami. Kropki i łączniki zostają (część zapisu
 * numeru RR.MM.DD-SSS.CC).
 */
export function attachmentNameForScan(name: string): string {
  return name.replace(/\.[A-Za-z0-9]{1,5}$/, '').replace(/[_+]+/g, ' ');
}

/** Czy nazwa pliku zawiera numer identyfikacyjny osoby lub dokumentu (#495). */
export function attachmentNameHasPersonalIdentifier(name: string | null | undefined): boolean {
  return !!name && containsPersonalIdentifier(attachmentNameForScan(name));
}

export function checkAttachmentFile(file: { size: number; type: string; name?: string }): AttachmentFileProblem | null {
  if (file.size === 0) return 'empty';
  if (file.size > ATTACHMENT_MAX_BYTES) return 'tooLarge';
  if (!ATTACHMENT_ALLOWED_TYPES.has(file.type)) return 'type';
  return attachmentNameHasPersonalIdentifier(file.name) ? 'sensitiveId' : null;
}
