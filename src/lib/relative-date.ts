/**
 * Względna data publikacji oferty („dzisiaj”, „wczoraj”, „3 dni temu”) liczona na serwerze.
 *
 * Strony publiczne są statyczne/ISR (#298), więc HTML karty żyje w cache. Dlatego napis
 * zależy wyłącznie od DNIA KALENDARZOWEGO w strefie `Europe/Brussels`, a nie od godzin:
 * zmienia się raz na dobę (o północy), a nie co godzinę, więc cache’owany HTML jest zgodny
 * z rzeczywistością przez całe okno rewalidacji. Dni liczymy kalendarzowo (nie przez
 * zaokrąglanie różnicy milisekund) — oferta sprzed 13 godzin z tego samego dnia to
 * „dzisiaj”, a nie „wczoraj”. Data z przyszłości (rozjazd zegarów) = „dzisiaj”.
 * Komponent kliencki tego nie liczy, więc nie ma rozjazdu SSR ↔ hydratacja (#391).
 */

export const PUBLISHED_DATE_TIME_ZONE = 'Europe/Brussels';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Numer dnia kalendarzowego (dni od epoki) dla chwili `ms` w strefie `timeZone`. */
function calendarDay(ms: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date(ms));
  const get = (type: 'year' | 'month' | 'day') =>
    Number(parts.find((part) => part.type === type)?.value);
  return Math.floor(Date.UTC(get('year'), get('month') - 1, get('day')) / DAY_MS);
}

export function formatPublishedRelative(
  iso: string,
  locale: string,
  now: number = Date.now(),
  timeZone: string = PUBLISHED_DATE_TIME_ZONE,
): string {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const days = Math.max(0, calendarDay(now, timeZone) - calendarDay(then, timeZone));
  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (days < 7) return rtf.format(-days, 'day');
  const weeks = Math.round(days / 7);
  if (weeks < 5) return rtf.format(-weeks, 'week');
  return rtf.format(-Math.max(1, Math.round(days / 30)), 'month');
}
