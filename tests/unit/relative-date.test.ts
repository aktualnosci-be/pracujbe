import { describe, expect, it } from 'vitest';

import { formatPublishedRelative } from '@/lib/relative-date';

/**
 * #391: względna data karty oferty liczona na serwerze, zgodnie z ISR — po dniu
 * kalendarzowym w Europe/Brussels, więc napis w cache’owanym HTML zmienia się tylko o północy.
 */

const at = (iso: string) => Date.parse(iso);

describe('formatPublishedRelative', () => {
  it('ten sam dzień kalendarzowy = „dzisiaj”, także 13 godzin wcześniej (nie „wczoraj”)', () => {
    // 00:30 i 13:45 czasu brukselskiego (CEST, UTC+2) tego samego dnia.
    expect(formatPublishedRelative('2026-09-23T22:30:00Z', 'pl', at('2026-09-24T11:45:00Z'))).toBe('dzisiaj');
    expect(formatPublishedRelative('2026-09-24T11:44:00Z', 'en', at('2026-09-24T11:45:00Z'))).toBe('today');
  });

  it('granicą dnia jest północ w Brukseli, nie w UTC', () => {
    // 23:50 w Brukseli 23.09 vs 00:10 w Brukseli 24.09 (w UTC to wciąż 23.09).
    expect(formatPublishedRelative('2026-09-23T21:50:00Z', 'pl', at('2026-09-23T22:10:00Z'))).toBe('wczoraj');
    // 01:00 UTC 24.09 = 03:00 w Brukseli; 21:30 UTC 23.09 = 23:30 w Brukseli 23.09 → wczoraj.
    expect(formatPublishedRelative('2026-09-23T21:30:00Z', 'en', at('2026-09-24T01:00:00Z'))).toBe('yesterday');
  });

  it('napis nie zmienia się w ciągu doby (stabilny w oknie rewalidacji ISR)', () => {
    const published = '2026-09-20T10:00:00Z';
    const morning = formatPublishedRelative(published, 'en', at('2026-09-24T06:00:00Z'));
    const evening = formatPublishedRelative(published, 'en', at('2026-09-24T21:00:00Z'));
    expect(morning).toBe('4 days ago');
    expect(evening).toBe(morning);
  });

  it.each([
    ['2026-09-17T10:00:00Z', 'last week'],
    ['2026-09-03T10:00:00Z', '3 weeks ago'],
    ['2026-08-20T10:00:00Z', 'last month'],
    ['2026-06-24T10:00:00Z', '3 months ago'],
  ])('tygodnie i miesiące: %s → %s', (published, expected) => {
    expect(formatPublishedRelative(published, 'en', at('2026-09-24T12:00:00Z'))).toBe(expected);
  });

  it('przestawienie czasu (DST) nie przesuwa liczby dni', () => {
    // 25.10.2026 Belgia przechodzi z CEST na CET.
    expect(formatPublishedRelative('2026-10-24T10:00:00Z', 'en', at('2026-10-26T10:00:00Z'))).toBe('2 days ago');
  });

  it('data z przyszłości (rozjazd zegarów) = „dzisiaj”, niepoprawna = pusty napis', () => {
    expect(formatPublishedRelative('2026-09-25T10:00:00Z', 'en', at('2026-09-24T12:00:00Z'))).toBe('today');
    expect(formatPublishedRelative('not-a-date', 'en', at('2026-09-24T12:00:00Z'))).toBe('');
  });

  it.each([
    ['pl', 'wczoraj'],
    ['nl', 'gisteren'],
    ['fr', 'hier'],
    ['en', 'yesterday'],
  ])('tłumaczy w języku strony: %s', (locale, expected) => {
    expect(formatPublishedRelative('2026-09-23T10:00:00Z', locale, at('2026-09-24T10:00:00Z'))).toBe(expected);
  });
});
