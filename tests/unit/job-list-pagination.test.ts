import { describe, expect, it } from 'vitest';

import {
  MAX_JOB_LIST_OFFSET,
  isJobListPageBeyondLimit,
  jobListLastPage,
  jobListNaturalOffset,
  maxReachableJobListPage,
} from '@/lib/job-list-pagination';

/**
 * #593 — brak powtórzeń publicznej listy ofert po osiągnięciu offsetu 10 000: koniec listy
 * musi być jawny (strona poza granicą nie ma prawa zduplikować klampowanego wycinka innej
 * strony). Ten plik testuje wyłącznie czyste funkcje graniczne — zachowanie
 * `getPublicJobs` (brak zapytania RPC dla strony poza granicą) jest w
 * `tests/unit/public-jobs-pagination.test.ts`.
 */

describe('granice paginacji publicznej listy ofert (#593)', () => {
  it('naturalny (nieklampowany) offset rośnie liniowo z numerem strony', () => {
    expect(jobListNaturalOffset(1, 12)).toBe(0);
    expect(jobListNaturalOffset(2, 12)).toBe(12);
    expect(jobListNaturalOffset(835, 12)).toBe(10_008);
  });

  it('strona tuż w granicy sufitu jest osiągalna, strona tuż za nią — nie', () => {
    // offset(834) = 9996 <= 10000 (osiągalna), offset(835) = 10008 > 10000 (poza granicą).
    expect(isJobListPageBeyondLimit(834, 12)).toBe(false);
    expect(isJobListPageBeyondLimit(835, 12)).toBe(true);
  });

  it('dokładnie na granicy (offset == sufit) strona jest jeszcze osiągalna', () => {
    expect(isJobListPageBeyondLimit(2, 10_000)).toBe(false); // offset = 10000
    expect(isJobListPageBeyondLimit(3, 10_000)).toBe(true); // offset = 20000
  });

  it('ostatnia osiągalna strona nie przekracza sufitu niezależnie od `total`', () => {
    const expected = Math.floor(MAX_JOB_LIST_OFFSET / 12) + 1;
    expect(maxReachableJobListPage(12)).toBe(expected);
    expect(jobListLastPage(1_000_000, 12)).toBe(expected);
    expect(jobListLastPage(Number.MAX_SAFE_INTEGER, 12)).toBe(expected);
  });

  it('dla katalogu poniżej sufitu ostatnia strona wynika z `total` (małe listy bez zmian)', () => {
    expect(jobListLastPage(25, 12)).toBe(3); // ceil(25/12) = 3
    expect(jobListLastPage(0, 12)).toBe(1);
    expect(jobListLastPage(12, 12)).toBe(1);
    expect(jobListLastPage(13, 12)).toBe(2);
  });

  it('kontrola ujemna: dawny wzór klampujący SAM offset dubluje różne, za duże strony', () => {
    // Zachowanie sprzed #593 (0026–0110 w SQL): `Math.min(10_000, (page - 1) * pageSize)` —
    // dwie różne, za duże strony mapują się na TEN SAM offset, więc RPC zwraca identyczny,
    // zduplikowany wycinek zamiast kolejnych wyników albo jawnego końca listy.
    const legacyClampedOffset = (page: number, pageSize: number) =>
      Math.min(10_000, (page - 1) * pageSize);
    const pageA = 900;
    const pageB = 901;
    expect(pageA).not.toBe(pageB);
    expect(legacyClampedOffset(pageA, 12)).toBe(legacyClampedOffset(pageB, 12));

    // Naprawa: obie strony są jawnie „poza granicą” (`src/lib/db/public-jobs.ts` w ogóle nie
    // odpytuje RPC dla nich), więc nie mogą zwrócić tego samego, zduplikowanego wycinka.
    expect(isJobListPageBeyondLimit(pageA, 12)).toBe(true);
    expect(isJobListPageBeyondLimit(pageB, 12)).toBe(true);
  });
});
