/**
 * Pola, które asystent redagowania (#37) może poprawić — wspólne dla serwera i przeglądarki
 * (bez `server-only`). Kolejność = kolejność w kreatorze.
 */

export const ASSIST_FIELDS = ['description', 'responsibilities', 'requirementsMandatory'] as const;
export type AssistField = (typeof ASSIST_FIELDS)[number];

/** Pola tekstowe (reszta to listy pozycji). */
export const ASSIST_TEXT_FIELDS: ReadonlySet<AssistField> = new Set(['description']);

/** Krok kreatora → pola asystenta na tym kroku. */
export const ASSIST_FIELDS_BY_STEP: Readonly<Record<number, readonly AssistField[]>> = {
  5: ['description', 'responsibilities'],
  6: ['requirementsMandatory'],
};

export type AssistValue = string | string[];

/** Powód, dla którego serwer nie pokazał propozycji dla pola. */
export type AssistDropReason = 'newFacts' | 'sensitive' | 'invalid';

export interface AssistSuggestion {
  field: AssistField;
  /** Tekst pracodawcy, dla którego powstała propozycja (do porównania i cofnięcia). */
  original: AssistValue;
  suggested: AssistValue;
}

export interface AssistDropped {
  field: AssistField;
  reason: AssistDropReason;
}

/** Porównanie wartości pola (tekst albo lista) — do wykrycia zmiany po propozycji. */
export function sameAssistValue(a: AssistValue, b: AssistValue): boolean {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return a.length === b.length && a.every((item, i) => item === b[i]);
}
