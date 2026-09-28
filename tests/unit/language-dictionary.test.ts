import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { buildMatchCandidate, buildMatchJob } from '@/lib/matching/inputs';
import { scoreMatch, type MatchCandidate, type MatchJob } from '@/lib/matching/score';
import {
  LANGUAGE_ALIASES,
  LANGUAGE_CODES,
  languageAliasKey,
  languageDisplayName,
  resolveLanguageCode,
} from '@/lib/languages';

/**
 * Słownik języków w dopasowaniu (I18N-02 / CF-02 / LIM17-05, migracja 0168).
 * - lista aliasów w kodzie = wiersze `language_aliases` w migracji (1:1, z kontrolą ujemną),
 * - kody = słownik `languages` z 0010, nazwy w `languageNames` we wszystkich językach,
 * - `scoreMatch` dopasowuje „niderlandzki” (UI PL) do „Nederlands” (UI NL) po kodzie.
 */

const ROOT = process.cwd();
const MIGRATION = readFileSync(resolve(ROOT, 'supabase/migrations/0168_language_dictionary_matching.sql'), 'utf8');
const SEED_0010 = readFileSync(resolve(ROOT, 'supabase/migrations/0010_seed_dictionaries.sql'), 'utf8');

function migrationAliases(sql: string): string[] {
  const block = sql.slice(sql.indexOf('insert into public.language_aliases'), sql.indexOf(') as v(code, alias)'));
  return [...block.matchAll(/\('([a-z]{2})', '((?:[^']|'')*)'\)/g)].map((m) => `${m[1]}:${(m[2] ?? '').replace(/''/g, "'")}`);
}
function codeAliases(aliases: Readonly<Record<string, readonly string[]>>): string[] {
  return Object.entries(aliases).flatMap(([code, list]) => list.map((a) => `${code}:${a}`));
}

describe('słownik języków — lustro bazy', () => {
  it('aliasy w kodzie = wiersze language_aliases w migracji 0168', () => {
    expect(migrationAliases(MIGRATION).sort()).toEqual(codeAliases(LANGUAGE_ALIASES).sort());
  });

  it('kontrola ujemna: dopisany alias w kodzie bez migracji jest wykrywany', () => {
    const changed = { ...LANGUAGE_ALIASES, nl: [...LANGUAGE_ALIASES.nl, 'Hollands'] };
    expect(migrationAliases(MIGRATION).sort()).not.toEqual(codeAliases(changed).sort());
  });

  it('kody = słownik languages z 0010 (w tej samej kolejności)', () => {
    const seeded = [...SEED_0010.matchAll(/\('([a-z]{2})', '[A-Za-z]+',\s*\d+, true, false\)/g)].map((m) => m[1]);
    expect(seeded).toEqual([...LANGUAGE_CODES]);
  });

  it('żaden klucz aliasu nie wskazuje dwóch języków', () => {
    const owner = new Map<string, string>();
    for (const [code, list] of Object.entries(LANGUAGE_ALIASES)) {
      for (const key of [code, ...list.map(languageAliasKey)]) {
        expect(owner.get(key) ?? code, `alias ${key}`).toBe(code);
        owner.set(key, code);
      }
    }
  });

  it('każdy kod ma nazwę w languageNames w pl/nl/fr/en', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = JSON.parse(readFileSync(resolve(ROOT, 'src/messages', `${locale}.json`), 'utf8')) as {
        languageNames: Record<string, string>;
      };
      expect(Object.keys(messages.languageNames).sort()).toEqual([...LANGUAGE_CODES].sort());
    }
  });
});

describe('resolveLanguageCode / languageDisplayName', () => {
  it('nazwy PL/NL/FR/EN (bez znaków diakrytycznych, NFD, spacje) → ten sam kod', () => {
    for (const label of ['niderlandzki', 'Nederlands', 'néerlandais', 'Neerlandais', 'Dutch', ' vlaams ', 'nl']) {
      expect(resolveLanguageCode(label), label).toBe('nl');
    }
    expect(resolveLanguageCode('Néerlandais')).toBe('nl');
    expect(resolveLanguageCode('język  polski')).toBe('pl');
    expect(resolveLanguageCode('bulgarski')).toBe('bg');
  });

  it('etykieta spoza słownika zostaje tekstem', () => {
    expect(resolveLanguageCode('Esperanto')).toBeNull();
    expect(resolveLanguageCode('')).toBeNull();
    expect(languageDisplayName('Esperanto', () => 'X')).toBe('Esperanto');
  });

  it('nazwa w języku widza zamiast etykiety drugiej strony', () => {
    const fr: Record<string, string> = { nl: 'Néerlandais' };
    expect(languageDisplayName('Niderlandzki', (code) => fr[code] ?? code)).toBe('Néerlandais');
    expect(languageDisplayName('nl', (code) => fr[code] ?? code)).toBe('Néerlandais');
  });
});

function candidate(overrides: Partial<MatchCandidate> = {}): MatchCandidate {
  return { occupations: [], categories: [], skills: [], languages: [], certificates: [], preferredContractTypes: [], ...overrides };
}
function job(overrides: Partial<MatchJob> = {}): MatchJob {
  return { skills: [], requiredLanguages: [], ...overrides };
}

describe('scoreMatch po kodzie języka (CF-02)', () => {
  const polishCandidate = candidate({ languages: [{ label: 'niderlandzki', level: 'fluent' }] });
  const dutchJob = job({ requiredLanguages: [{ label: 'Nederlands', level: 'intermediate' }] });

  it('„niderlandzki” (UI PL) spełnia „Nederlands” (UI NL)', () => {
    const r = scoreMatch(polishCandidate, dutchJob);
    expect(r.matched).toContain('Nederlands');
    expect(r.missing).not.toContain('Nederlands');
    expect(r.languageGaps).toEqual([]);
  });

  it('kod z bazy wygrywa z etykietą (wiersz słownikowy z nazwą zastępczą)', () => {
    const r = scoreMatch(
      candidate({ languages: [{ label: 'Dutch', level: 'basic', code: 'nl' }] }),
      job({ requiredLanguages: [{ label: 'Dutch', level: 'fluent', code: 'nl' }] }),
    );
    expect(r.languageGaps).toEqual([{ language: 'Dutch', required: 'fluent', actual: 'basic' }]);
  });

  it('dwa warianty tej samej nazwy u kandydata = jeden język z wyższym poziomem', () => {
    const r = scoreMatch(
      candidate({ languages: [{ label: 'francuski', level: 'basic' }, { label: 'Français', level: 'native' }] }),
      job({ requiredLanguages: [{ label: 'French', level: 'fluent' }] }),
    );
    expect(r.matched).toContain('French');
  });

  it('mapowanie wierszy bazy przenosi kod (relacje i jsonb RPC)', () => {
    const c = buildMatchCandidate({}, {
      skills: [], certificates: [],
      languages: [{ language_label: 'Nederlands', level: 'fluent', language_code: 'nl' }],
    }, []);
    const j = buildMatchJob({ language_requirements: [{ label: 'Niderlandzki', level: 'basic', code: 'nl' }] }, []);
    expect(c.languages).toEqual([{ label: 'Nederlands', level: 'fluent', code: 'nl' }]);
    expect(scoreMatch(c, j).matched).toContain('Niderlandzki');
  });

  it('kontrola ujemna: porównanie samych napisów (stary norm) nie dopasowuje', () => {
    const oldNorm = (v: string) => v.trim().toLowerCase();
    expect(oldNorm('niderlandzki')).not.toBe(oldNorm('Nederlands'));
    const r = scoreMatch(
      candidate({ languages: [{ label: 'Esperanto', level: 'fluent' }] }),
      job({ requiredLanguages: [{ label: 'Nederlands', level: 'basic' }] }),
    );
    expect(r.missing).toContain('Nederlands');
  });
});

describe('LIM17-05: klucz porównania etykiet', () => {
  it('„Wozek  widlowy” i NFD spełniają „Wózek widłowy”', () => {
    for (const skill of ['Wozek  widlowy', 'Wózek widłowy', ' wózek WIDŁOWY ']) {
      const r = scoreMatch(candidate({ skills: [skill] }), job({ skills: ['Wózek widłowy'] }));
      expect(r.matched, skill).toContain('Wózek widłowy');
    }
  });
});
