import { describe, expect, it } from 'vitest';

import { allowsTrackingOnPath, isOneTimeLinkPath } from '@/lib/analytics/route-policy';

describe('analytics route policy', () => {
  it.each([
    '/pl/aplikacja/potwierdz',
    '/nl/aplikacja/przejmij',
    '/fr/wypisz',
    '/en/ustaw-nowe-haslo',
    '/nl/potwierdz-email',
    '/pl/logowanie',
    '/pl/rejestracja',
    '/pl/candidate/aplikacje',
    '/pl/employer/kandydaci',
    '/pl/admin',
  ])('blocks tracking on %s', (path) => {
    expect(allowsTrackingOnPath(path)).toBe(false);
  });

  it.each(['/', '/pl', '/pl/oferty-pracy', '/nl/oferty-pracy/monteur'])
    ('allows tracking on public discovery page %s', (path) => {
      expect(allowsTrackingOnPath(path)).toBe(true);
    });

  it.each([
    '/pl/aplikacja/potwierdz',
    '/nl/aplikacja/przejmij',
    '/fr/wypisz',
    '/en/ustaw-nowe-haslo',
    '/nl/potwierdz-email',
  ])('requires private response headers on %s', (path) => {
    expect(isOneTimeLinkPath(path)).toBe(true);
  });

  it('does not change caching on public listings', () => {
    expect(isOneTimeLinkPath('/pl/oferty-pracy')).toBe(false);
  });
});
