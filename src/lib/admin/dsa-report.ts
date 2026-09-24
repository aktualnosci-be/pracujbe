import { APP_TIME_ZONE, appDayStartUtc } from '@/lib/datetime';

/**
 * Okres raportu przejrzystości DSA (#43) z parametrów URL `od`/`do` (`YYYY-MM-DD`, dni
 * w Europe/Brussels, `do` włącznie). Domyślnie: od 1 stycznia bieżącego roku do dziś.
 * Czysta funkcja — wspólna dla strony raportu i trasy eksportu.
 */

export const DSA_REPORT_MAX_DAYS = 5 * 366;

export type DsaReportRange =
  | { ok: true; fromYmd: string; toYmd: string; from: Date; to: Date }
  | { ok: false; fromYmd: string; toYmd: string };

/** Dzisiejsza data `YYYY-MM-DD` w strefie produktu. */
export function todayYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function parseDsaReportRange(
  fromRaw: string | null | undefined,
  toRaw: string | null | undefined,
  now: Date = new Date(),
): DsaReportRange {
  const today = todayYmd(now);
  const fromYmd = fromRaw && fromRaw.length > 0 ? fromRaw : `${today.slice(0, 4)}-01-01`;
  const toYmd = toRaw && toRaw.length > 0 ? toRaw : today;
  const fromIso = appDayStartUtc(fromYmd);
  const toIso = appDayStartUtc(toYmd, true);
  if (!fromIso || !toIso) return { ok: false, fromYmd, toYmd };
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const days = (to.getTime() - from.getTime()) / 86_400_000;
  if (!(days > 0) || days > DSA_REPORT_MAX_DAYS) return { ok: false, fromYmd, toYmd };
  return { ok: true, fromYmd, toYmd, from, to };
}
