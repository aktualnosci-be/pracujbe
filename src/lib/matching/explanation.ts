import { summaryKeyForScore, type MatchResult } from '@/lib/matching/score';

/**
 * Krótkie wyjaśnienie ZAPISANEGO dopasowania (`matches`, materializacja P1-03) dla list
 * kandydata — polecane oferty. Pełne wyjaśnienie (braki, poziomy języków) liczy szczegół
 * oferty na żywo (`JobMatchCard`); tutaj tylko to, co da się pokazać bez ponownego liczenia:
 *
 * - etykieta wyniku z procentu (`summaryKeyForScore` — to samo źródło co `scoreMatch`, więc
 *   procent i opis nigdy sobie nie przeczą, także dla starszych wierszy z domyślnym
 *   `summary_key`),
 * - „Wymagania obowiązkowe: X z Y” tylko przy spójnych liczbach (Y > 0, 0 ≤ X ≤ Y),
 * - najwyżej `RECOMMENDED_STRENGTHS_SHOWN` atutów, WYŁĄCZNIE ze znanych kluczy
 *   (`match.criteria.*`). Nieznana wartość z bazy nie trafia do UI (brak surowego tekstu).
 */

/** Klucze atutów, które `scoreMatch` wpisuje do `strengths` (tłumaczenia `match.criteria`). */
export const MATCH_STRENGTH_KEYS = [
  'allMandatorySkills',
  'localCandidate',
  'remoteJob',
  'withinCommuteRadius',
  'experienceExceeds',
  'immediateStart',
  'noLanguageBarrier',
  'ownTransport',
] as const;

export type MatchStrengthKey = (typeof MATCH_STRENGTH_KEYS)[number];

export const RECOMMENDED_STRENGTHS_SHOWN = 2;

export interface MatchExplanation {
  summaryKey: MatchResult['summaryKey'];
  /** `null` = oferta bez wymagań obowiązkowych albo liczby niespójne — pole ukryte. */
  mandatory: { met: number; total: number } | null;
  strengths: MatchStrengthKey[];
}

const STRENGTH_SET: ReadonlySet<string> = new Set(MATCH_STRENGTH_KEYS);

function isStrengthKey(value: unknown): value is MatchStrengthKey {
  return typeof value === 'string' && STRENGTH_SET.has(value);
}

function count(value: unknown): number | null {
  const n = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof n === 'number' && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Wiersz `matches` (score, mandatory_met, mandatory_total, strengths) → wyjaśnienie. */
export function toMatchExplanation(row: {
  score: number;
  mandatoryMet: unknown;
  mandatoryTotal: unknown;
  strengths: unknown;
}): MatchExplanation {
  const met = count(row.mandatoryMet);
  const total = count(row.mandatoryTotal);
  const mandatory = met !== null && total !== null && total > 0 && met <= total ? { met, total } : null;
  const strengths = Array.isArray(row.strengths)
    ? [...new Set(row.strengths.filter(isStrengthKey))].slice(0, RECOMMENDED_STRENGTHS_SHOWN)
    : [];
  return { summaryKey: summaryKeyForScore(row.score), mandatory, strengths };
}
