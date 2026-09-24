import { describe, expect, it } from 'vitest';

import {
  distanceKm,
  languageShare,
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

  it('bez współrzędnych ten sam region nie udaje „w promieniu dojazdu" (#194)', () => {
    const j = job({ city: 'Liege', region: 'Liège Province' });
    const wide = scoreMatch(candidate({ city: 'Seraing', region: 'Liège Province', radiusKm: 60 }), j);
    const small = scoreMatch(candidate({ city: 'Seraing', region: 'Liège Province', radiusKm: 10 }), j);

    // Odległość nieznana: region = 10/15 niezależnie od promienia, bez etykiety „w promieniu".
    expect(wide.strengths).not.toContain('withinCommuteRadius');
    expect(wide.score).toBe(small.score);
    expect(wide.score).toBe(95);
  });

  describe('lokalizacja z odległości i promienia (#194)', () => {
    const BRUSSELS = { lat: 50.8503, lng: 4.3517 };
    const MECHELEN = { lat: 51.0281, lng: 4.4776 }; // ~21 km od Brukseli, inny region
    const BRUGES = { lat: 51.2097, lng: 3.2247 }; // ~87 km od Mechelen, ten sam region
    const KORTRIJK = { lat: 50.8282, lng: 3.2649 };

    it('odległość haversine jest poprawna i symetryczna', () => {
      const d = distanceKm(BRUSSELS, MECHELEN);
      expect(d).toBeGreaterThan(20);
      expect(d).toBeLessThan(23);
      expect(distanceKm(MECHELEN, BRUSSELS)).toBeCloseTo(d, 10);
      expect(distanceKm(BRUSSELS, BRUSSELS)).toBe(0);
    });

    it('bliskie miasta w różnych regionach: w promieniu → 15 pkt i „w promieniu"', () => {
      const r = scoreMatch(
        candidate({ city: 'Brussels', region: 'Brussels-Capital', radiusKm: 30, coordinates: BRUSSELS }),
        job({ city: 'Mechelen', region: 'Flanders', coordinates: MECHELEN }),
      );
      expect(r.strengths).toContain('withinCommuteRadius');
      expect(r.missing).not.toContain('location');
      expect(r.score).toBe(100);
    });

    it('dalekie miasta w tym samym regionie: poza promieniem → 0 pkt (kontrola ujemna)', () => {
      const r = scoreMatch(
        candidate({ city: 'Bruges', region: 'Flanders', radiusKm: 50, coordinates: BRUGES }),
        job({ city: 'Mechelen', region: 'Flanders', coordinates: MECHELEN }),
      );
      expect(r.strengths).not.toContain('withinCommuteRadius');
      expect(r.missing).toContain('location');
      expect(r.score).toBe(85);
    });

    it('granica promienia: odległość równa promieniowi mieści się, o włos mniejszy promień nie', () => {
      const d = distanceKm(BRUGES, KORTRIJK);
      const j = job({ city: 'Kortrijk', region: 'Flanders', coordinates: KORTRIJK });
      const at = scoreMatch(candidate({ city: 'Bruges', radiusKm: d, coordinates: BRUGES }), j);
      const below = scoreMatch(candidate({ city: 'Bruges', radiusKm: d - 0.01, coordinates: BRUGES }), j);
      expect(at.strengths).toContain('withinCommuteRadius');
      expect(below.missing).toContain('location');
    });

    it('brak promienia przy znanych współrzędnych innego miasta → brak punktów', () => {
      const r = scoreMatch(
        candidate({ city: 'Brussels', region: 'Flanders', coordinates: BRUSSELS }),
        job({ city: 'Mechelen', region: 'Flanders', coordinates: MECHELEN }),
      );
      expect(r.missing).toContain('location');
    });

    it('brak współrzędnych jednej strony → reguła nazw, bez szacowania odległości', () => {
      const r = scoreMatch(
        candidate({ city: 'Brussels', region: 'Flanders', radiusKm: 100, coordinates: BRUSSELS }),
        job({ city: 'Aalst', region: 'Flanders' }),
      );
      expect(r.strengths).not.toContain('withinCommuteRadius');
      expect(r.score).toBe(95);
    });

    it('oferta zdalna ignoruje odległość', () => {
      const r = scoreMatch(
        candidate({ city: 'Bruges', radiusKm: 5, coordinates: BRUGES }),
        job({ remote: true, city: 'Mechelen', coordinates: MECHELEN }),
      );
      expect(r.strengths).toContain('remoteJob');
      expect(r.score).toBe(100);
    });
  });

  describe('poziom języka (#195)', () => {
    const nl = (level: string | null) => ({ label: 'Niderlandzki', level });

    it('reguła udziału: równy/wyższy = 1, o poziom niżej = 0,5, niżej = 0, nieznany = 0', () => {
      expect(languageShare('fluent', 'fluent')).toBe(1);
      expect(languageShare('fluent', 'native')).toBe(1);
      expect(languageShare('fluent', 'intermediate')).toBe(0.5);
      expect(languageShare('fluent', 'basic')).toBe(0);
      expect(languageShare('fluent', null)).toBe(0);
      expect(languageShare(null, null)).toBe(1);
      expect(languageShare(null, undefined)).toBe(0);
    });

    it('niższy poziom nie daje pełnych 10 pkt ani oznaczenia spełnienia (kontrola ujemna)', () => {
      const j = job({ requiredLanguages: [nl('fluent')] });
      const basic = scoreMatch(candidate({ languages: [nl('basic')] }), j);
      expect(basic.score).toBe(90);
      expect(basic.matched).not.toContain('Niderlandzki');
      expect(basic.missing).not.toContain('Niderlandzki');
      expect(basic.languageGaps).toEqual([{ language: 'Niderlandzki', required: 'fluent', actual: 'basic' }]);

      const oneBelow = scoreMatch(candidate({ languages: [nl('intermediate')] }), j);
      expect(oneBelow.score).toBe(95);
      expect(oneBelow.matched).not.toContain('Niderlandzki');
    });

    it('równy lub wyższy poziom daje pełne punkty i oznaczenie spełnienia', () => {
      const j = job({ requiredLanguages: [nl('fluent')] });
      for (const level of ['fluent', 'native']) {
        const r = scoreMatch(candidate({ languages: [nl(level)] }), j);
        expect(r.score).toBe(100);
        expect(r.matched).toContain('Niderlandzki');
        expect(r.languageGaps).toEqual([]);
      }
    });

    it('nieznany poziom kandydata przy wymaganym poziomie → 0 pkt i luka z actual=null', () => {
      const r = scoreMatch(
        candidate({ languages: ['Niderlandzki'] }),
        job({ requiredLanguages: [nl('intermediate')] }),
      );
      expect(r.score).toBe(90);
      expect(r.languageGaps).toEqual([{ language: 'Niderlandzki', required: 'intermediate', actual: null }]);
    });

    it('oferta bez poziomu: każdy deklarowany poziom spełnia wymóg', () => {
      const r = scoreMatch(candidate({ languages: [nl('basic')] }), job({ requiredLanguages: ['niderlandzki'] }));
      expect(r.score).toBe(100);
    });

    it('kilka wymaganych języków liczy się osobno', () => {
      const r = scoreMatch(
        candidate({
          languages: [nl('native'), { label: 'Francuski', level: 'basic' }],
        }),
        job({
          requiredLanguages: [nl('fluent'), { label: 'Francuski', level: 'fluent' }, { label: 'Angielski', level: 'basic' }],
        }),
      );
      // NL 1 + FR 0 + EN brak 0 → 10/3 ≈ 3 pkt.
      expect(r.score).toBe(93);
      expect(r.matched).toContain('Niderlandzki');
      expect(r.missing).toContain('Angielski');
      expect(r.languageGaps).toEqual([{ language: 'Francuski', required: 'fluent', actual: 'basic' }]);
    });
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
