/**
 * Grafik pracy oferty (#858, migracja 0227 — numer tymczasowy) — moduł czysty, bez Zoda
 * (importują go klienckie panele filtrów, #390). Ta sama lista co w bazie:
 * `public.job_shift_pattern_values()` (CHECK `jobs.shift_patterns`, filtr `p_shift_patterns`
 * listy ofert, kanonizacja zapisanych wyszukiwań `shiftPatterns`). Zgodność pilnuje test
 * `job-shift-patterns`.
 *
 * Pracodawca deklaruje jeden lub więcej typów; opis tekstowy godzin i zmian zostaje jako
 * uzupełnienie. Starych ofert nie klasyfikujemy z tekstu (brak deklaracji = brak danych).
 */

/** Typy grafiku w kolejności wyświetlania (= kolejność kanoniczna zapisu w bazie). */
export const SHIFT_PATTERNS = [
  'day',
  'two_shift',
  'three_shift',
  'night',
  'weekend',
  'split',
  'continuous',
] as const;
export type ShiftPattern = (typeof SHIFT_PATTERNS)[number];

/** Parametr adresu listy ofert (CSV, jak `contract`). */
export const SHIFT_PATTERN_PARAM = 'shift';

export function isShiftPattern(value: unknown): value is ShiftPattern {
  return typeof value === 'string' && (SHIFT_PATTERNS as readonly string[]).includes(value);
}

/**
 * Lista znanych typów bez duplikatów, w kolejności kanonicznej (lustro
 * `job_shift_patterns_from_jsonb`). Nieznane wartości są pomijane — parser adresu i danych
 * z bazy nie zgaduje.
 */
export function normalizeShiftPatterns(values: readonly unknown[] | null | undefined): ShiftPattern[] {
  if (!values) return [];
  const set = new Set(values.filter(isShiftPattern));
  return SHIFT_PATTERNS.filter((p) => set.has(p));
}

/** Wartość parametru `shift` (CSV) → typy grafiku. */
export function parseShiftPatternsParam(value: string | undefined): ShiftPattern[] {
  if (!value) return [];
  return normalizeShiftPatterns(value.split(',').map((v) => v.trim()));
}

/**
 * Czy oferta pasuje do filtra — lustro warunku SQL (`j.shift_patterns && p_shift_patterns`):
 * pusty filtr = każda oferta, inaczej oferta musi mieć którykolwiek z wybranych typów;
 * oferta bez deklaracji nie pasuje.
 */
export function shiftPatternsMatch(
  job: readonly ShiftPattern[] | undefined,
  filter: readonly ShiftPattern[],
): boolean {
  if (filter.length === 0) return true;
  return Boolean(job?.some((p) => filter.includes(p)));
}
