/**
 * Rozpoczęcie pracy w ofercie (#1112, TIME21-03): kreator zbiera „Pracę od zaraz”
 * (`start_immediately`/`immediate`) i datę rozpoczęcia (`start_date`, kolumna `date`), a strona
 * oferty ich nie pokazywała. Jedno źródło wyniku dla strony (bez JavaScriptu po stronie klienta).
 */
export interface JobStartInfo {
  /** „Praca od zaraz”. */
  immediate: boolean;
  /** Data rozpoczęcia `YYYY-MM-DD` albo `null` (brak/niepoprawna). */
  date: string | null;
}

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function jobStartInfo(job: { immediate?: boolean; startDate?: string }): JobStartInfo {
  const match = job.startDate ? DATE_RE.exec(job.startDate) : null;
  let date: string | null = null;
  if (match) {
    const [, y, m, d] = match;
    const parsed = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
    // Odrzuca daty spoza kalendarza (np. 2026-02-31), które `Date` po cichu przesuwa.
    if (
      parsed.getUTCFullYear() === Number(y) &&
      parsed.getUTCMonth() === Number(m) - 1 &&
      parsed.getUTCDate() === Number(d)
    ) {
      date = `${y}-${m}-${d}`;
    }
  }
  return { immediate: job.immediate === true, date };
}

/**
 * Data kalendarzowa (bez godziny) jako chwila w UTC — formatować ZAWSZE z `timeZone: 'UTC'`,
 * inaczej strefa serwera/przeglądarki przesuwa dzień.
 */
export function jobStartDateInstant(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}
