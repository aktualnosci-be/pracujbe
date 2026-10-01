import { cityKey } from '@/lib/matching/belgian-cities';

/**
 * Dodatkowe miejsca pracy oferty (#850, migracja 0982). Lustro reguł RPC
 * `set_job_work_locations`: najwyżej 10 pozycji, każda 2–80 znaków po złożeniu spacji, bez
 * znaków sterujących; duplikaty (po kluczu `city_key`) i wpis równy miastu głównemu są pomijane.
 * Miasto główne zostaje w `jobs.city` — lista to miejsca DODATKOWE.
 */
export const WORK_LOCATIONS_MAX = 10;
export const WORK_LOCATION_NAME_MIN = 2;
export const WORK_LOCATION_NAME_MAX = 80;

/** Spacje (także twarde) złożone do jednej, obcięte końce — jak `regexp_replace` w RPC. */
export function normalizeWorkLocationName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Lista zapisywana przez RPC: znormalizowane nazwy w kolejności, bez duplikatów i bez miasta
 * głównego. Nie waliduje długości (to robi schemat kroku) — tylko kształt wyniku bazy.
 */
export function dedupeWorkLocations(names: readonly string[], mainCity: string): string[] {
  const seen = new Set<string>([cityKey(mainCity)]);
  const out: string[] = [];
  for (const raw of names) {
    const name = normalizeWorkLocationName(raw);
    const key = cityKey(name);
    if (name === '' || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** Wiersze `get_public_job_work_locations` → nazwy w kolejności (puste i nieznany kształt pominięte). */
export function parseWorkLocationRows(rows: readonly unknown[]): string[] {
  return rows
    .map((row) => (row && typeof row === 'object' ? (row as Record<string, unknown>) : {}))
    .map((row) => ({
      name: typeof row['name'] === 'string' ? normalizeWorkLocationName(row['name']) : '',
      position: typeof row['position'] === 'number' ? row['position'] : Number(row['position']),
    }))
    .filter((row) => row.name !== '')
    .sort((a, b) => (Number.isFinite(a.position) ? a.position : 0) - (Number.isFinite(b.position) ? b.position : 0))
    .map((row) => row.name);
}
