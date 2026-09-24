/**
 * Formatowanie dat w strefie czasowej produktu (Europe/Brussels) — #421.
 *
 * Serwer (Railway) działa w UTC, więc `Intl.DateTimeFormat` bez `timeZone` pokazywałby
 * godziny przesunięte o 1–2 h, a daty bez godziny mogłyby przeskoczyć o dzień przy
 * zdarzeniach blisko północy. Wszystkie widoki paneli formatują przez ten helper.
 */

export const APP_TIME_ZONE = 'Europe/Brussels';

export interface FormatAppDateOptions {
  /** true → data + godzina (`timeStyle: 'short'`); domyślnie sama data. */
  withTime?: boolean;
  /** Tekst dla braku/niepoprawnej wartości. */
  fallback?: string;
}

/** Tworzy formatter dla danego locale (jeden na stronę — tańsze niż nowy przy każdym wierszu). */
export function createAppDateFormatter(
  locale: string,
  { withTime = false, fallback = '—' }: FormatAppDateOptions = {},
): (iso: string | null | undefined) => string {
  const fmt = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    ...(withTime ? { timeStyle: 'short' } : {}),
    timeZone: APP_TIME_ZONE,
  });
  return (iso) => {
    if (!iso) return fallback;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? fallback : fmt.format(date);
  };
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Przesunięcie strefy produktu względem UTC (ms) w danej chwili. */
function appOffsetMs(instant: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(instant));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return asUtc - Math.floor(instant / 1000) * 1000;
}

/**
 * Początek dnia `YYYY-MM-DD` w Europe/Brussels jako ISO UTC (filtry zakresu dat, #417).
 * Zła data → null. `endExclusive` = początek następnego dnia (górna granica `<`).
 */
export function appDayStartUtc(ymd: string | null | undefined, endExclusive = false): string | null {
  const m = ymd ? YMD_RE.exec(ymd) : null;
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const naive = Date.UTC(y, mo - 1, d + (endExclusive ? 1 : 0));
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) {
    return null;
  }
  // Dwa przybliżenia wystarczają (zmiana czasu w Brukseli nie wypada o północy).
  let guess = naive - appOffsetMs(naive);
  guess = naive - appOffsetMs(guess);
  return new Date(guess).toISOString();
}
