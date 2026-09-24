// @vitest-environment node
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { parseCsv, parseCsvObjects, writeCsv } from '../../scripts/esco/lib/csv.mjs';
import { importSnapshot } from '../../scripts/esco/lib/import.mjs';
import {
  ESCO_LOCALES,
  buildManifest,
  manifestDigest,
  parseSnapshot,
  readVerifiedFiles,
  validateManifest,
} from '../../scripts/esco/lib/snapshot.mjs';
import { parseArgs, safeMessage } from '../../scripts/esco/esco-import.mjs';

const FIXTURE = resolve('tests/fixtures/esco/esco-v1.2.1-sample');
const loadManifest = async () => JSON.parse(await readFile(`${FIXTURE}.manifest.json`, 'utf8'));
const loadModel = async () => parseSnapshot(await readVerifiedFiles(FIXTURE, await loadManifest()));

const temps: string[] = [];
afterEach(async () => {
  for (const dir of temps.splice(0)) {
    if (!dir.startsWith(join(resolve(tmpdir()), 'pracujbe-esco-'))) throw new Error('Nieprawidłowy katalog testu.');
    await rm(dir, { recursive: true, force: true });
  }
});

/** Kopia fragmentu z modyfikacją jednego pliku i nowym manifestem. */
async function mutated(name: string, change: (text: string) => string) {
  const dir = await mkdtemp(join(tmpdir(), 'pracujbe-esco-'));
  temps.push(dir);
  await cp(FIXTURE, dir, { recursive: true });
  await writeFile(join(dir, name), change(await readFile(join(dir, name), 'utf8')));
  return { dir, manifest: await buildManifest(dir, { snapshot: 'esco-v1.2.1-sample', sample: true }) };
}

describe('CSV ESCO', () => {
  it('obsługuje cudzysłowy, "" , nowe linie w polu, CRLF i BOM', () => {
    const text = '﻿a,b\r\n"x, ""y""","l1\nl2"\n';
    expect(parseCsv(text)).toEqual([['a', 'b'], ['x, "y"', 'l1\nl2']]);
    const header = ['a', 'b'];
    const rows = [{ a: 'x, "y"', b: 'l1\nl2' }];
    expect(parseCsvObjects(writeCsv(header, rows))).toEqual(rows);
  });

  it('odrzuca niezamknięty cudzysłów, brak kolumny i złą liczbę pól', () => {
    expect(() => parseCsv('a\n"x')).toThrow('niezamknięty');
    expect(() => parseCsvObjects('a,b\n1,2\n', ['c'])).toThrow('brak kolumn: c');
    expect(() => parseCsvObjects('a,b\n1\n')).toThrow('ma 1 pól zamiast 2');
  });
});

describe('Manifest ESCO', () => {
  it('przypina wersję v1.2.1 i dokładnie języki portalu', async () => {
    const manifest = await loadManifest();
    expect(validateManifest(manifest).locales.sort()).toEqual([...ESCO_LOCALES].sort());
    expect(() => validateManifest({ ...manifest, escoVersion: 'v1.2.0' })).toThrow('v1.2.1');
    expect(() => validateManifest({ ...manifest, locales: [...ESCO_LOCALES, 'ro'] })).toThrow('języki');
    expect(() => validateManifest({ ...manifest, locales: ['pl', 'en'] })).toThrow('języki');
    expect(() => validateManifest({ ...manifest, sample: false })).toThrow('-sample');
    const files = { ...manifest.files };
    delete files['skills_nl.csv'];
    expect(() => validateManifest({ ...manifest, files })).toThrow('skills_nl.csv');
  });

  it('skrót manifestu nie zależy od kolejności kluczy', async () => {
    const manifest = await loadManifest();
    const reordered = { ...manifest, files: Object.fromEntries(Object.entries(manifest.files).reverse()) };
    expect(manifestDigest(reordered)).toBe(manifestDigest(manifest));
    expect(manifestDigest({ ...manifest, snapshot: 'inny-sample' })).not.toBe(manifestDigest(manifest));
  });

  it('manifest w repozytorium odpowiada plikom fragmentu', async () => {
    expect(await buildManifest(FIXTURE, { snapshot: 'esco-v1.2.1-sample', sample: true })).toEqual(await loadManifest());
  });

  it('zmieniony plik przy tym samym manifeście = odmowa', async () => {
    const { dir } = await mutated('skills_pl.csv', text => text.replace('magazynach', 'magazynie'));
    await expect(readVerifiedFiles(dir, await loadManifest())).rejects.toThrow('Suma kontrolna skills_pl.csv');
  });
});

describe('Parser snapshotu ESCO', () => {
  it('czyta fragment: zawody, umiejętności, relacje podstawowe i opcjonalne, 4 języki', async () => {
    const model = await loadModel();
    expect([model.occupations.length, model.skills.length, model.relations.length]).toEqual([5, 22, 24]);
    expect(model.report.essential).toBeGreaterThan(0);
    expect(model.report.optional).toBeGreaterThan(0);
    expect(model.report.essential + model.report.optional).toBe(24);
    for (const concept of [...model.occupations, ...model.skills]) {
      expect(Object.keys(concept.labels).sort()).toEqual([...ESCO_LOCALES].sort());
      expect(concept.name).toBe(concept.labels.en.preferred);
      expect(concept.uri).toMatch(/^http:\/\/data\.europa\.eu\/esco\/(occupation|skill)\//);
    }
    const cook = model.occupations.find(o => o.uri.endsWith('90f75f67-495d-49fa-ab57-2f320e251d7e'));
    expect(cook?.labels.pl.preferred).toBe('kucharz/kucharka');
    expect(cook?.labels.pl.alternative).toEqual(['gastronom', 'kucharka', 'kucharz']);
  });

  it('jest deterministyczny: ten sam snapshot → identyczny model (podstawa idempotencji)', async () => {
    expect(await loadModel()).toEqual(await loadModel());
  });

  it('raportuje brak tłumaczenia jako brak etykiety preferowanej', async () => {
    const { dir, manifest } = await mutated('occupations_nl.csv', text => text.replace(',7112,metselaar,', ',7112,,'));
    const model = parseSnapshot(await readVerifiedFiles(dir, manifest));
    expect(model.report.missingTranslations.occupation?.nl).toBe(1);
    expect(model.report.missingTranslationUris.occupation.nl).toHaveLength(1);
    expect(model.report.missingTranslations.occupation?.pl).toBe(0);
  });

  it('odrzuca sprzeczne dane między językami, relacje do nieznanych URI i różne pliki relacji', async () => {
    const code = await mutated('occupations_fr.csv', text => text.replace(',5120.1', ',5120.9'));
    expect(() => parseSnapshot(new Map())).toThrow();
    await expect(readVerifiedFiles(code.dir, code.manifest).then(parseSnapshot)).rejects.toThrow('pole code różni się');
    const unknown = await mutated('occupationSkillRelations_en.csv', text => text.replace(/skill\/01fec851/g, 'skill/01fec852'));
    await expect(readVerifiedFiles(unknown.dir, unknown.manifest).then(parseSnapshot)).rejects.toThrow('nieznanej umiejętności');
    const differs = await mutated('occupationSkillRelations_pl.csv', text => text.replace(',essential,', ',optional,'));
    await expect(readVerifiedFiles(differs.dir, differs.manifest).then(parseSnapshot)).rejects.toThrow('różnią się');
    const badType = await mutated('skills_en.csv', text => text.replace(',cross-sector,', ',everywhere,'));
    await expect(readVerifiedFiles(badType.dir, badType.manifest).then(parseSnapshot)).rejects.toThrow('reuseLevel');
  });
});

type Call = { sql: string; params?: unknown[] };
function fakeClient(fail?: RegExp) {
  const calls: Call[] = [];
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (fail?.test(sql)) throw Object.assign(new Error('ESCO_MANUAL_CONFLICT'), { code: '23505' });
      if (sql.includes('esco_begin_snapshot')) return { rows: [{ status: 'repeat' }] };
      if (sql.includes('esco_finish_snapshot')) return { rows: [{ r: { removedRelations: 0 } }] };
      if (sql.includes('esco_upsert')) return { rows: [{ r: { inserted: 0, updated: 0 } }] };
      return { rows: [] };
    },
  };
}

describe('Import ESCO (orkiestracja)', () => {
  it('jedna transakcja jako service_role; ten sam snapshot → identyczne wywołania', async () => {
    const [manifest, model] = [await loadManifest(), await loadModel()];
    const a = fakeClient();
    const b = fakeClient();
    await importSnapshot(a, { manifest, model, allowSample: true, batchSize: 4 });
    await importSnapshot(b, { manifest, model, allowSample: true, batchSize: 4 });
    const strip = (calls: Call[]) => calls.map(c => [c.sql, (c.params ?? []).map(p => String(p).replace(/"importedAt":"[^"]+"/, ''))]);
    expect(strip(a.calls)).toEqual(strip(b.calls));
    expect(a.calls[0]?.sql).toBe('BEGIN');
    expect(a.calls[1]?.sql).toBe('SET LOCAL ROLE service_role');
    expect(a.calls.at(-1)?.sql).toBe('COMMIT');
    expect(a.calls.filter(c => c.sql.includes('esco_upsert_occupations'))).toHaveLength(2);
  });

  it('dry-run kończy ROLLBACK, błąd cofa całość, fragment wymaga --allow-sample', async () => {
    const [manifest, model] = [await loadManifest(), await loadModel()];
    const dry = fakeClient();
    await importSnapshot(dry, { manifest, model, allowSample: true, dryRun: true });
    expect(dry.calls.at(-1)?.sql).toBe('ROLLBACK');
    const failing = fakeClient(/esco_upsert_skills/);
    await expect(importSnapshot(failing, { manifest, model, allowSample: true })).rejects.toThrow('ESCO_MANUAL_CONFLICT');
    expect(failing.calls.at(-1)?.sql).toBe('ROLLBACK');
    expect(failing.calls.some(c => c.sql === 'COMMIT')).toBe(false);
    const sample = fakeClient();
    await expect(importSnapshot(sample, { manifest, model })).rejects.toThrow('--allow-sample');
    expect(sample.calls).toHaveLength(0);
    await expect(importSnapshot(sample, { manifest, model, allowSample: true, manual: 'always' })).rejects.toThrow('manual');
  });

  it('CLI: nadpisanie danych ręcznych tylko jawnie, komunikaty bez danych bazy', () => {
    expect(parseArgs(['import', '--dir', 'x']).manual).toBe('fail');
    expect(parseArgs(['import', '--dir=x', '--manual=skip', '--dry-run']).dryRun).toBe(true);
    expect(() => parseArgs(['import', '--dir', 'x', '--manual', 'yes'])).toThrow('--manual');
    expect(() => parseArgs(['import', '--dir', 'x', '--force'])).toThrow('Nieznany argument');
    expect(() => parseArgs(['drop', '--dir', 'x'])).toThrow('Użycie');
    expect(safeMessage(Object.assign(new Error('ESCO_CHECKSUM_MISMATCH'), { code: '23514' }))).toBe('ESCO_CHECKSUM_MISMATCH');
    expect(safeMessage(Object.assign(new Error('duplicate key (email)=(a@b.c)'), { code: '23505' }))).not.toContain('a@b.c');
  });
});
