import 'server-only';
import { timingSafeEqual } from 'node:crypto';

/** Nagłówek z tokenem monitoringu wewnętrznego (`HEALTH_CHECK_SECRET`). */
export const HEALTH_TOKEN_HEADER = 'x-health-token';

/** Stałoczasowe porównanie tokena (anty-timing). Zwraca false, gdy token nieustawiony/niezgodny. */
export function healthTokenMatches(provided: string | null): boolean {
  const expected = process.env.HEALTH_CHECK_SECRET;
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
