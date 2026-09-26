import { findSensitiveData } from '@/lib/privacy/sensitive-data';

/**
 * Krótki cytat wiadomości rekrutera w e-mailu `jobOffer` (#503, decyzja właściciela
 * 26.09.2026: „tak, krótki cytat”).
 *
 * Pełna treść (`offers.message`) nigdy nie trafia do payloadu kolejki ani do szablonu —
 * worker czyta ją w chwili wysyłki i przekazuje wyłącznie wynik tej funkcji jako
 * `messageExcerpt`. Kolejność ma znaczenie: najpierw usuwamy dane kontaktowe i
 * identyfikatory (na pełnym tekście, więc obcięcie nie zostawi połowy numeru), potem
 * skracamy do `MESSAGE_EXCERPT_MAX` znaków (łącznie z wielokropkiem).
 *
 * Usuwane (zastępowane neutralnym `[…]`, bez tekstu w konkretnym języku):
 *   - e-maile, telefony, NISS/BIS/PESEL, numery kart i dokumentów — detektory
 *     `src/lib/privacy/sensitive-data.ts` (te same co w aplikacji i imporcie AI);
 *   - adresy URL (ze schematem, `www.` albo host z domeną i ścieżką).
 * Fail-closed: jeśli po redakcji detektor nadal coś znajduje albo zostaje znak `@`,
 * cytatu nie ma (e-mail bez cytatu, treść w panelu).
 */
export const MESSAGE_EXCERPT_MAX = 200;
export const EXCERPT_REDACTION = '[…]';

const URL_RE =
  /\b(?:(?:https?|ftp):\/\/|www\.)[^\s<>"'`]+|\b(?:[a-z0-9-]+\.)+[a-z]{2,}\/[^\s<>"'`]*/gi;
// Znaki sterujące (poza spacjami, które i tak zwijamy) i znaki kierunku tekstu.
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁦-⁩]/g;

function collapse(text: string): string {
  return text.replace(CONTROL_RE, ' ').replace(/\s+/g, ' ').trim();
}

function redact(text: string): string {
  const matches = findSensitiveData(text);
  let out = '';
  let cursor = 0;
  for (const m of matches) {
    out += text.slice(cursor, m.start) + EXCERPT_REDACTION;
    cursor = m.end;
  }
  out += text.slice(cursor);
  return out.replace(URL_RE, EXCERPT_REDACTION);
}

function truncate(text: string): string {
  if (text.length <= MESSAGE_EXCERPT_MAX) return text;
  const hard = text.slice(0, MESSAGE_EXCERPT_MAX - 1);
  const lastSpace = hard.lastIndexOf(' ');
  // Tniemy na granicy słowa, chyba że dałoby to bardzo krótki cytat.
  const cut = lastSpace >= MESSAGE_EXCERPT_MAX / 2 ? hard.slice(0, lastSpace) : hard;
  return `${cut.replace(/[\s.,;:!?-]+$/u, '')}…`;
}

/** Oczyszczony cytat ≤ 200 znaków albo `null` (brak treści / nic bezpiecznego do pokazania). */
export function buildMessageExcerpt(message: unknown): string | null {
  if (typeof message !== 'string') return null;
  const clean = collapse(redact(collapse(message)));
  if (clean.replaceAll(EXCERPT_REDACTION, '').replace(/[\s\p{P}]/gu, '') === '') return null;
  const excerpt = truncate(clean);
  if (excerpt.includes('@') || findSensitiveData(excerpt).length > 0) return null;
  return excerpt;
}
