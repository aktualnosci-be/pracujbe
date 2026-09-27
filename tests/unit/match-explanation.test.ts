import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';
import {
  MATCH_STRENGTH_KEYS,
  RECOMMENDED_STRENGTHS_SHOWN,
  toMatchExplanation,
} from '@/lib/matching/explanation';
import { summaryKeyForScore } from '@/lib/matching/score';

describe('toMatchExplanation — wyjaśnienie zapisanego dopasowania (polecane oferty)', () => {
  it('etykieta liczona z procentu tymi samymi progami co scoreMatch', () => {
    expect([0, 39, 40, 69, 70, 100].map(summaryKeyForScore)).toEqual(['low', 'low', 'partial', 'partial', 'good', 'good']);
    // Starszy wiersz z domyślnym summary_key='low' i score 91 nie pokaże „Niskie dopasowanie”.
    expect(toMatchExplanation({ score: 91, mandatoryMet: 0, mandatoryTotal: 0, strengths: [] }).summaryKey).toBe('good');
  });

  it('wymagania obowiązkowe tylko przy spójnych liczbach', () => {
    const at = (met: unknown, total: unknown) =>
      toMatchExplanation({ score: 50, mandatoryMet: met, mandatoryTotal: total, strengths: [] }).mandatory;
    expect(at(2, 3)).toEqual({ met: 2, total: 3 });
    expect(at('1', '1')).toEqual({ met: 1, total: 1 });
    expect(at(0, 0)).toBeNull();
    expect(at(4, 3)).toBeNull();
    expect(at(-1, 3)).toBeNull();
    expect(at(1.5, 3)).toBeNull();
    expect(at(null, 3)).toBeNull();
    expect(at('', 3)).toBeNull();
  });

  it('atuty: tylko znane klucze, bez duplikatów, najwyżej dwa', () => {
    const e = toMatchExplanation({
      score: 80,
      mandatoryMet: 0,
      mandatoryTotal: 0,
      strengths: ['Wózek widłowy', 'remoteJob', 'remoteJob', 42, 'ownTransport', 'immediateStart'],
    });
    expect(e.strengths).toEqual(['remoteJob', 'ownTransport']);
    expect(RECOMMENDED_STRENGTHS_SHOWN).toBe(2);
    // Kontrola ujemna: nie-tablica i klucz spoza listy nie trafiają do UI.
    expect(toMatchExplanation({ score: 80, mandatoryMet: 0, mandatoryTotal: 0, strengths: 'remoteJob' }).strengths).toEqual([]);
    expect(toMatchExplanation({ score: 80, mandatoryMet: 0, mandatoryTotal: 0, strengths: ['notAKey'] }).strengths).toEqual([]);
  });

  it('lista kluczy = dokładnie atuty wpisywane przez scoreMatch (strażnik źródła)', () => {
    const source = readFileSync(join(process.cwd(), 'src/lib/matching/score.ts'), 'utf8');
    const pushed = [...source.matchAll(/strengths\.push\('([A-Za-z]+)'\)/g)].map((m) => m[1]);
    expect(pushed.length).toBeGreaterThan(0);
    expect([...new Set(pushed)].sort()).toEqual([...MATCH_STRENGTH_KEYS].sort());
  });

  it('każdy klucz atutu i etykiety ma tłumaczenie w 4 językach', () => {
    for (const messages of [pl, nl, fr, en]) {
      for (const key of MATCH_STRENGTH_KEYS) expect(messages.match.criteria[key]).toBeTruthy();
      for (const key of ['good', 'partial', 'low'] as const) expect(messages.match.summaryShort[key]).toBeTruthy();
      expect(messages.dashboard.recommendedApplied).toBeTruthy();
    }
  });
});
