import { describe, expect, it } from 'vitest';

import {
  scoreMatch,
  type MatchCandidate,
  type MatchJob,
} from '@/lib/matching/score';

/**
 * Testy deterministycznego silnika dopasowania (scoreMatch).
 *
 * Wagi (suma = 100): zawód 12 + kategoria 8, umiejętności 20, lokalizacja 15,
 * doświadczenie 10, dostępność 10, język 10, certyfikaty 5, transport 5, umowa 5.
 * Progi summaryKey: >=70 'good', >=40 'partial', <40 'low'.
 */

/** Kandydat bazowy — puste kolekcje; testy nadpisują wybrane pola. */
function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return {
    occupations: [],
    categories: [],
    skills: [],
    languages: [],
    certificates: [],
    preferredContractTypes: [],
    ...overrides,
  };
}

/** Oferta bazowa — brak wymagań; testy nadpisują wybrane pola. */
function job(overrides: Partial<MatchJob> = {}): MatchJob {
  return {
    skills: [],
    requiredLanguages: [],
    ...overrides,
  };
}

describe('scoreMatch', () => {
  it('daje 100 dla pełnego dopasowania i summaryKey "good"', () => {
    const result = scoreMatch(
      candidate({
        occupations: ['Warehouse worker'],
        categories: ['warehouse'],
        skills: ['Forklift', 'Picking'],
        city: 'Antwerp',
        region: 'Antwerp Province',
        experienceYears: 5,
        availability: 'immediate',
        languages: ['English'],
        certificates: ['VCA'],
        hasDrivingLicense: true,
        hasCar: true,
        preferredContractTypes: ['permanent'],
      }),
      job({
        occupation: 'warehouse worker',
        category: 'warehouse',
        skills: ['forklift', 'picking'],
        mandatorySkills: ['forklift', 'picking'],
        city: 'Antwerp',
        region: 'Antwerp Province',
        minExperienceYears: 2,
        requiredLanguages: ['english'],
        requiredCertificates: ['vca'],
        requiresDrivingLicense: true,
        contractType: 'permanent',
        startImmediately: true,
      }),
    );

    expect(result.score).toBe(100);
    expect(result.summaryKey).toBe('good');
    expect(result.mandatoryMet).toBe(2);
    expect(result.mandatoryTotal).toBe(2);
    expect(result.missing).toEqual([]);
    expect(result.strengths).toContain('allMandatorySkills');
  });

  it('daje 100 dla oferty bez żadnych wymagań (wszystko opcjonalne)', () => {
    const result = scoreMatch(candidate(), job());

    expect(result.score).toBe(100);
    expect(result.summaryKey).toBe('good');
    expect(result.mandatoryTotal).toBe(0);
    expect(result.mandatoryMet).toBe(0);
    // Brak wymaganego języka => brak bariery językowej.
    expect(result.strengths).toContain('noLanguageBarrier');
  });

  it('daje 0 przy całkowitym braku dopasowania i summaryKey "low"', () => {
    const result = scoreMatch(
      candidate({
        occupations: ['cleaner'],
        categories: ['cleaning'],
        skills: ['mopping'],
        city: 'Brussels',
        region: 'Brussels-Capital Region',
        experienceYears: 0,
        languages: ['Polish'],
        certificates: [],
        hasDrivingLicense: false,
        hasCar: false,
        preferredContractTypes: ['temporary'],
      }),
      job({
        occupation: 'welder',
        category: 'technical',
        skills: ['welding', 'mig'],
        city: 'Ghent',
        region: 'East Flanders',
        minExperienceYears: 5,
        requiredLanguages: ['Dutch'],
        requiredCertificates: ['welding cert'],
        requiresDrivingLicense: true,
        contractType: 'permanent',
        startImmediately: true,
      }),
    );

    expect(result.score).toBe(0);
    expect(result.summaryKey).toBe('low');
    expect(result.matched).toEqual([]);
    expect(result.missing).toContain('location');
    expect(result.missing).toContain('drivingLicense');
    expect(result.missing).toContain('contractType');
  });

  it('daje wynik częściowy (40-69) i summaryKey "partial"', () => {
    const result = scoreMatch(
      candidate({
        occupations: ['driver'], // +12
        categories: ['transport'], // +8
        skills: ['routes'], // 1/3 * 20 = 7
        city: 'Ghent',
        region: 'East Flanders', // brak dopasowania regionu -> 0
        experienceYears: 2, // 2/4 * 10 = 5
        availability: 'twoWeeks', // dostępny, ale nie "od zaraz" -> 5
        languages: ['French'], // 1/2 * 10 = 5
        certificates: [], // 0/1 -> 0
        hasDrivingLicense: true, // +5
        preferredContractTypes: ['temporary'], // nie pasuje -> 0
      }),
      job({
        occupation: 'driver',
        category: 'transport',
        skills: ['ce', 'routes', 'adr'],
        city: 'Liege',
        region: 'Liège Province',
        minExperienceYears: 4,
        requiredLanguages: ['French', 'Dutch'],
        requiredCertificates: ['code95'],
        requiresDrivingLicense: true,
        contractType: 'permanent',
        startImmediately: true,
      }),
    );

    expect(result.score).toBe(47);
    expect(result.score).toBeGreaterThanOrEqual(40);
    expect(result.score).toBeLessThan(70);
    expect(result.summaryKey).toBe('partial');
  });

  it('liczy mandatoryMet/mandatoryTotal niezależnie od wyniku ogólnego', () => {
    const result = scoreMatch(
      candidate({ skills: ['a', 'B'] }),
      job({
        skills: [],
        mandatorySkills: ['A', 'b', 'c'],
      }),
    );

    // Dopasowanie bez uwzględnienia wielkości liter: 'a' i 'B'/'b' pasują, 'c' brakuje.
    expect(result.mandatoryTotal).toBe(3);
    expect(result.mandatoryMet).toBe(2);
    expect(result.missing).toContain('c');
    expect(result.strengths).not.toContain('allMandatorySkills');
  });

  it('progi summaryKey rozróżniają wysoki (good) i niski (low) wynik', () => {
    // Kandydat pasujący tylko zawodem+umiejętnościami przy jednym niedopasowanym
    // wymaganym języku (traci 10) i pozostałych wymiarach "za darmo".
    const good = scoreMatch(
      candidate({ occupations: ['x'], skills: ['s1'] }),
      job({ occupation: 'x', skills: ['s1'], requiredLanguages: ['nl'] }),
    );
    // 12 (occ) + 8 (cat brak) + 20 (skill) + 15 (loc brak wymagań) + 10 (exp)
    // + 10 (avail) + 0 (lang) + 5 (cert) + 5 (transport) + 5 (contract) = 90
    expect(good.summaryKey).toBe('good');
    expect(good.score).toBeGreaterThanOrEqual(70);

    const low = scoreMatch(
      candidate(),
      job({
        occupation: 'x',
        category: 'y',
        skills: ['s1', 's2'],
        city: 'A',
        region: 'B',
        minExperienceYears: 3,
        requiredLanguages: ['nl'],
        requiredCertificates: ['c'],
        requiresDrivingLicense: true,
        contractType: 'permanent',
        startImmediately: true,
      }),
    );
    // Pusty kandydat wobec pełnych wymagań: tylko umowa (+5, bo brak preferencji = elastyczny).
    expect(low.summaryKey).toBe('low');
    expect(low.score).toBeLessThan(40);
  });

  it('praca zdalna znosi ograniczenie lokalizacji (FUN-06)', () => {
    const base = candidate({ city: 'Brussels', region: 'Brussels-Capital' });
    const remoteJob = job({ remote: true, city: 'Ghent', region: 'East Flanders' });
    const onsiteJob = job({ city: 'Ghent', region: 'East Flanders' });

    const remoteResult = scoreMatch(base, remoteJob);
    const onsiteResult = scoreMatch(base, onsiteJob);

    // Remote: pełne punkty lokalizacji + atut; on-site (brak dopasowania): brak.
    expect(remoteResult.strengths).toContain('remoteJob');
    expect(onsiteResult.missing).toContain('location');
    expect(remoteResult.score).toBeGreaterThan(onsiteResult.score);
  });

  it('duży promień dojazdu daje pełne punkty przy dopasowaniu regionu (FUN-06)', () => {
    const j = job({ city: 'Liege', region: 'Liège Province' });
    const near = scoreMatch(candidate({ city: 'Seraing', region: 'Liège Province', radiusKm: 60 }), j);
    const local = scoreMatch(candidate({ city: 'Seraing', region: 'Liège Province', radiusKm: 10 }), j);

    // Ten sam region: promień >=50 => pełne punkty + atut; mały promień => tylko częściowe.
    expect(near.strengths).toContain('withinCommuteRadius');
    expect(near.score).toBeGreaterThan(local.score);
  });

  it('niespełnione wymaganie obowiązkowe blokuje wynik "good" (FUN-06, próg)', () => {
    // Kandydat spełnia niemal wszystko poza jedną obowiązkową umiejętnością.
    const result = scoreMatch(
      candidate({
        occupations: ['x'],
        categories: ['warehouse'],
        skills: ['a'],
        city: 'A',
        region: 'B',
        experienceYears: 10,
        availability: 'immediate',
      }),
      job({
        occupation: 'x',
        category: 'warehouse',
        skills: ['a', 'b'],
        mandatorySkills: ['a', 'b'], // 'b' niespełnione => próg
        city: 'A',
        region: 'B',
      }),
    );
    expect(result.mandatoryMet).toBe(1);
    expect(result.mandatoryTotal).toBe(2);
    // Mimo wysokiego dopasowania — brak obowiązkowej umiejętności trzyma wynik poniżej „good".
    expect(result.score).toBeLessThanOrEqual(65);
    expect(result.summaryKey).not.toBe('good');
  });

  it('jest deterministyczny: te same wejścia => ten sam wynik', () => {
    const c = candidate({ occupations: ['x'], skills: ['s1', 's2'] });
    const j = job({ occupation: 'x', skills: ['s1'] });
    expect(scoreMatch(c, j)).toEqual(scoreMatch(c, j));
  });
});
