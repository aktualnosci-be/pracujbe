import { describe, expect, it } from 'vitest';

import {
  decodeScoreCursor,
  decodeTimeCursor,
  encodeScoreCursor,
  encodeTimeCursor,
  listPageHref,
  listPageRequest,
  listRequestHref,
  toListPage,
} from '@/lib/employer/list-cursor';

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-000000000001';
const TS = '2026-09-20T09:00:00.123456+00:00';

describe('kursory list panelu pracodawcy (P1-05)', () => {
  it('kursor czasu: round-trip bez utraty mikrosekund, token bezpieczny w URL', () => {
    const token = encodeTimeCursor({ ts: TS, id: ID });
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeTimeCursor(token)).toEqual({ ts: TS, id: ID });
  });

  it('kursor wyniku: tylko 0–100 i UUID', () => {
    expect(decodeScoreCursor(encodeScoreCursor({ score: 97, id: ID }))).toEqual({ score: 97, id: ID });
    expect(decodeScoreCursor(encodeScoreCursor({ score: 0, id: ID }))).toEqual({ score: 0, id: ID });
    expect(decodeScoreCursor(Buffer.from(`101|${ID}`).toString('base64url'))).toBeNull();
    expect(decodeScoreCursor(Buffer.from(`-1|${ID}`).toString('base64url'))).toBeNull();
    expect(decodeScoreCursor(Buffer.from(`97;drop|${ID}`).toString('base64url'))).toBeNull();
  });

  it('niezaufany token = brak kursora (pierwsza strona), nie błąd', () => {
    for (const bad of [undefined, '', 'x'.repeat(201), '%%%', ['a', 'b'], Buffer.from('bez-separatora').toString('base64url'),
      Buffer.from(`${TS}|nie-uuid`).toString('base64url'), Buffer.from(`wczoraj|${ID}`).toString('base64url')]) {
      expect(decodeTimeCursor(bad)).toBeNull();
    }
    // Kursor czasu nie przechodzi jako kursor wyniku i odwrotnie.
    expect(decodeScoreCursor(encodeTimeCursor({ ts: TS, id: ID }))).toBeNull();
    expect(decodeTimeCursor(encodeScoreCursor({ score: 5, id: ID }))).toBeNull();
  });

  it('parametry adresu: `po` = dalej, `przed` = wstecz, zły token ignorowany', () => {
    const token = encodeTimeCursor({ ts: TS, id: ID });
    expect(listPageRequest({ po: token }, decodeTimeCursor)).toEqual({ cursor: { ts: TS, id: ID }, direction: 'next' });
    expect(listPageRequest({ przed: token }, decodeTimeCursor)).toEqual({ cursor: { ts: TS, id: ID }, direction: 'prev' });
    expect(listPageRequest({ po: 'zły', przed: token }, decodeTimeCursor).direction).toBe('prev');
    expect(listPageRequest({ po: [token, token] }, decodeTimeCursor)).toEqual({ cursor: null, direction: 'next' });
  });

  it('strona: znacznik ponad rozmiar tylko sygnalizuje kolejną stronę', () => {
    const rows = [1, 2, 3];
    const first = toListPage(rows, { cursor: null, direction: 'next' }, 2, String, (r) => r);
    expect(first).toEqual({ items: [1, 2], prevCursor: null, nextCursor: '2' });
    const last = toListPage([3], { cursor: 'c', direction: 'next' }, 2, String, (r) => r);
    expect(last).toEqual({ items: [3], prevCursor: '3', nextCursor: null });
    // Wstecz: baza czyta od kursora w górę (4, 3, 2) — strona w porządku listy + dalsza nowsza.
    const back = toListPage([4, 3, 2], { cursor: 'c', direction: 'prev' }, 2, String, (r) => r);
    expect(back).toEqual({ items: [3, 4], prevCursor: '3', nextCursor: '4' });
    const top = toListPage([4], { cursor: 'c', direction: 'prev' }, 2, String, (r) => r);
    expect(top).toEqual({ items: [4], prevCursor: null, nextCursor: '4' });
    expect(toListPage([], { cursor: 'c', direction: 'next' }, 2, String, (r) => r))
      .toEqual({ items: [], prevCursor: null, nextCursor: null });
  });

  it('adresy stron zachowują filtr i kodują token', () => {
    expect(listPageHref('/employer/aplikacje', 'po', null)).toBe('/employer/aplikacje');
    expect(listPageHref('/employer/aplikacje', 'po', 'abc', { oferta: ID })).toBe(`/employer/aplikacje?oferta=${ID}&po=abc`);
    const token = encodeTimeCursor({ ts: TS, id: ID });
    expect(listRequestHref('/employer/oferty', { cursor: { ts: TS, id: ID }, direction: 'prev' }, encodeTimeCursor))
      .toBe(`/employer/oferty?przed=${token}`);
  });
});
