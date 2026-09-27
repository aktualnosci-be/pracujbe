/**
 * Kursory list panelu pracodawcy (audyt P1-05) — czyste funkcje, bez dostępu do DB.
 *
 * Listy ofert i zgłoszeń stronicujemy krotką (czas, UUID), listę dopasowanych kandydatów —
 * krotką (wynik, UUID); tak jak historie kandydata (#180/#245) i listy admina (#418), zamiast
 * OFFSET. Kursor jest w adresie strony w obu kierunkach: `?po=` = starsze (dalsze) wyniki,
 * `?przed=` = nowsze (wcześniejsze). Wartości z URL są niezaufane: zły token = pierwsza strona.
 */

export type ListDirection = 'next' | 'prev';

/** Kursor czasu: `ts` dokładnie jak z bazy (mikrosekundy — bez przepuszczania przez `Date`). */
export interface TimeCursor {
  ts: string;
  id: string;
}

/** Kursor wyniku dopasowania (0–100) i kandydata. */
export interface ScoreCursor {
  score: number;
  id: string;
}

export interface ListPageRequest<C> {
  cursor: C | null;
  direction: ListDirection;
}

/** Wynik strony: pozycje w porządku listy + tokeny sąsiednich stron (null = brak). */
export interface ListPage<T> {
  items: T[];
  /** Token `?przed=` — nowsze pozycje; null na pierwszej stronie. */
  prevCursor: string | null;
  /** Token `?po=` — starsze pozycje; null na ostatniej stronie. */
  nextCursor: string | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)$/;
const SCORE_RE = /^(100|[1-9]?\d)$/;
const TOKEN_RE = /^[A-Za-z0-9_-]{1,200}$/;

function encode(key: string, id: string): string {
  return Buffer.from(`${key}|${id}`, 'utf8').toString('base64url');
}

function decode(token: unknown): { key: string; id: string } | null {
  if (typeof token !== 'string' || !TOKEN_RE.test(token)) return null;
  const raw = Buffer.from(token, 'base64url').toString('utf8');
  const sep = raw.lastIndexOf('|');
  if (sep <= 0) return null;
  const id = raw.slice(sep + 1);
  return UUID_RE.test(id) ? { key: raw.slice(0, sep), id } : null;
}

export function encodeTimeCursor(cursor: TimeCursor): string {
  return encode(cursor.ts, cursor.id);
}

export function decodeTimeCursor(token: unknown): TimeCursor | null {
  const parsed = decode(token);
  return parsed && TIMESTAMP_RE.test(parsed.key) ? { ts: parsed.key, id: parsed.id } : null;
}

export function encodeScoreCursor(cursor: ScoreCursor): string {
  return encode(String(cursor.score), cursor.id);
}

export function decodeScoreCursor(token: unknown): ScoreCursor | null {
  const parsed = decode(token);
  return parsed && SCORE_RE.test(parsed.key) ? { score: Number(parsed.key), id: parsed.id } : null;
}

/** Parametry adresu → żądanie strony. `po` ma pierwszeństwo; oba niepoprawne = pierwsza strona. */
export function listPageRequest<C>(
  params: { po?: string | string[]; przed?: string | string[] },
  decodeCursor: (token: unknown) => C | null,
): ListPageRequest<C> {
  const next = decodeCursor(params.po);
  if (next) return { cursor: next, direction: 'next' };
  const prev = decodeCursor(params.przed);
  if (prev) return { cursor: prev, direction: 'prev' };
  return { cursor: null, direction: 'next' };
}

/**
 * Wiersze z bazy (LIMIT size + 1; 'next' w porządku listy, 'prev' odwrotnie) → strona z tokenami.
 * Wiersz ponad `size` jest tylko znacznikiem istnienia kolejnej strony w kierunku odczytu.
 */
export function toListPage<R, T>(
  rows: R[],
  request: ListPageRequest<unknown>,
  size: number,
  cursorOf: (row: R) => string,
  map: (row: R) => T,
): ListPage<T> {
  const more = rows.length > size;
  const slice = rows.slice(0, size);
  const ordered = request.direction === 'prev' ? slice.reverse() : slice;
  const first = ordered[0];
  const last = ordered[ordered.length - 1];
  const prevCursor = first && (request.direction === 'prev' ? more : request.cursor !== null) ? cursorOf(first) : null;
  const nextCursor = last && (request.direction === 'next' ? more : true) ? cursorOf(last) : null;
  return { items: ordered.map(map), prevCursor, nextCursor };
}

/** Adres strony listy z tokenem kursora (bez tokenu = pierwsza strona). */
export function listPageHref(base: string, param: 'po' | 'przed', token: string | null, extra: Record<string, string> = {}): string {
  const search = new URLSearchParams(extra);
  if (token) search.set(param, token);
  const query = search.toString();
  return query ? `${base}?${query}` : base;
}

/** Adres bieżącej strony (ponowienie po błędzie odczytu) — ten sam kursor i kierunek. */
export function listRequestHref<C>(
  base: string,
  request: ListPageRequest<C>,
  encodeCursor: (cursor: C) => string,
  extra: Record<string, string> = {},
): string {
  return listPageHref(base, request.direction === 'prev' ? 'przed' : 'po',
    request.cursor === null ? null : encodeCursor(request.cursor), extra);
}
