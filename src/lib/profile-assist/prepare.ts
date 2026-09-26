import { textHasInjection } from '@/lib/ai-assist/guard';
import { minimizeCvText, type CvRedactionCounts } from '@/lib/cv-import/minimize';
import {
  PROFILE_ANSWERS_MIN_CHARS,
  PROFILE_QUESTION_IDS,
  type ProfileAnswers,
  type ProfileQuestionId,
} from '@/lib/profile-assist/questions';

/**
 * Przygotowanie odpowiedzi kandydata PRZED wysłaniem do modelu (#37). Moduł czysty,
 * deterministyczny — ochrona nie opiera się na poleceniu w prompcie:
 *
 *   1. Polecenie dla AI w dowolnej odpowiedzi → odmowa (`suspicious`), nic nie wychodzi.
 *   2. Każda odpowiedź przechodzi tę samą minimalizację co tekst CV (`minimizeCvText`, #498):
 *      numer NISS/BIS/dokumentu → odmowa (`identifier`); linie o osobach trzecich
 *      (referencja, przełożony, osoba kontaktowa), dane osobowe i kategorie szczególne
 *      (art. 9/10) usunięte; e-maile, telefony i linki → znaczniki; kilka adresów albo
 *      kontakt w długiej odpowiedzi → bezpieczne zatrzymanie (`uncertain`).
 *   3. Odpowiedzi składamy w znaczniki `<answer topic="…">` (próby ich otwarcia/zamknięcia
 *      w treści neutralizowane).
 *
 * Zwracamy liczby usuniętych fragmentów (bez wartości) do informacji w UI.
 */

export type PreparedAnswers =
  | { ok: true; text: string; removed: CvRedactionCounts; topics: ProfileQuestionId[] }
  | { ok: false; reason: 'empty' | 'identifier' | 'uncertain' | 'suspicious' };

const ZERO: CvRedactionCounts = {
  referenceSections: 0,
  personalSections: 0,
  thirdPartyLines: 0,
  personalLines: 0,
  specialCategoryLines: 0,
  contacts: 0,
};

function neutralizeTags(text: string): string {
  return text.replace(/<\s*\/?\s*(?:answers?|profile_answers)\b[^>]*>/gi, '[tag removed]');
}

export function prepareProfileAnswers(answers: ProfileAnswers): PreparedAnswers {
  const filled = PROFILE_QUESTION_IDS.map((id) => [id, (answers[id] ?? '').trim()] as const).filter(([, v]) => v !== '');
  const total = filled.reduce((n, [, v]) => n + v.replace(/\s/g, '').length, 0);
  if (total < PROFILE_ANSWERS_MIN_CHARS) return { ok: false, reason: 'empty' };
  if (filled.some(([, v]) => textHasInjection(v))) return { ok: false, reason: 'suspicious' };

  const removed = { ...ZERO };
  const parts: string[] = [];
  const topics: ProfileQuestionId[] = [];
  for (const [id, value] of filled) {
    const minimized = minimizeCvText(value);
    if (!minimized.ok) {
      if (minimized.reason === 'identifier' || minimized.reason === 'uncertain') return { ok: false, reason: minimized.reason };
      // Po usunięciu nic nie zostało (np. sama linia o referencji) — pomijamy odpowiedź.
      continue;
    }
    for (const key of Object.keys(removed) as (keyof CvRedactionCounts)[]) removed[key] += minimized.counts[key];
    parts.push(`<answer topic="${id}">\n${neutralizeTags(minimized.text)}\n</answer>`);
    topics.push(id);
  }
  const text = parts.join('\n\n');
  if (text.replace(/<[^>]+>|\s/g, '').length < PROFILE_ANSWERS_MIN_CHARS) return { ok: false, reason: 'empty' };
  return { ok: true, text, removed, topics };
}
