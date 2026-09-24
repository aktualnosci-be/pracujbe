import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * Zakres dat lejka ofert (#99) w dniach kalendarzowych Europe/Brussels — tych samych, po
 * których baza grupuje agregat (0089). Zakres obejmuje dziś i `days - 1` poprzednich dni.
 */
export const FUNNEL_RANGE_OPTIONS = [7, 30, 90] as const;
export type FunnelRangeDays = (typeof FUNNEL_RANGE_OPTIONS)[number];
export const DEFAULT_FUNNEL_RANGE: FunnelRangeDays = 30;

export interface FunnelDateRange {
  days: FunnelRangeDays;
  /** Pierwszy dzień (YYYY-MM-DD, włącznie). */
  from: string;
  /** Ostatni dzień (YYYY-MM-DD, włącznie) — dziś w Brukseli. */
  to: string;
}

export function parseFunnelRange(value: unknown): FunnelRangeDays {
  const days = Number(Array.isArray(value) ? value[0] : value);
  return (FUNNEL_RANGE_OPTIONS as readonly number[]).includes(days)
    ? (days as FunnelRangeDays)
    : DEFAULT_FUNNEL_RANGE;
}

function brusselsToday(now: Date): string {
  // en-CA formatuje jako YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: APP_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

function shiftDays(ymd: string, delta: number): string {
  const date = new Date(`${ymd}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + delta);
  return date.toISOString().slice(0, 10);
}

export function funnelDateRange(days: FunnelRangeDays, now: Date = new Date()): FunnelDateRange {
  const to = brusselsToday(now);
  return { days, from: shiftDays(to, -(days - 1)), to };
}
