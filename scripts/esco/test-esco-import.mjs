/**
 * Integracyjny test importu ESCO (#93) na PostgreSQL 16 — pełny pipeline CLI
 * (sumy → parser → RPC 0097) na jawnie oznaczonym fragmencie testowym.
 *
 * Wymaga pustej, jednorazowej bazy o nazwie pracujbe_esco_test (nigdy produkcji):
 *   sudo -u postgres createdb pracujbe_esco_test
 *   ESCO_TEST_DATABASE_URL=postgresql:///pracujbe_esco_test?host=/var/run/postgresql \
 *     sudo -E -u postgres node scripts/esco/test-esco-import.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { applyMigrations } from '../db/migrate.mjs';
import { loadProductionMigrations } from '../db/production-migrations.mjs';
import { importSnapshot } from './lib/import.mjs';
import { parseSnapshot, readVerifiedFiles, validateManifest } from './lib/snapshot.mjs';

const url = process.env.ESCO_TEST_DATABASE_URL;
if (!url || new URL(url).pathname !== '/pracujbe_esco_test') throw new Error('Wymagana izolowana baza pracujbe_esco_test.');

const FIXTURE = new URL('../../tests/fixtures/esco/esco-v1.2.1-sample', import.meta.url).pathname;
const manifest = validateManifest(JSON.parse(await readFile(`${FIXTURE}.manifest.json`, 'utf8')));
const model = parseSnapshot(await readVerifiedFiles(FIXTURE, manifest));
const COOK = 'http://data.europa.eu/esco/occupation/90f75f67-495d-49fa-ab57-2f320e251d7e';

const client = new pg.Client({ connectionString: url });
await client.connect();
const one = async (sql, params) => (await client.query(sql, params)).rows[0];
const counts = async () => one(`select
  (select count(*)::int from occupations where source = 'esco') as occ,
  (select count(*)::int from skills where source = 'esco') as sk,
  (select count(*)::int from occupation_labels) as ol,
  (select count(*)::int from skill_labels) as sl,
  (select count(*)::int from occupation_skills) as rel,
  (select count(*)::int from occupations where source = 'manual') as manual`);
try {
  assert.equal((await one("select to_regclass('public.occupations') as t")).t, null, 'Test wymaga nowej bazy.');
  await applyMigrations(client, await loadProductionMigrations());

  // Ręczny wiersz z URI zawodu z paczki — import bez decyzji musi odmówić.
  await client.query(`insert into occupations (slug, name, source, esco_uri) values ('kucharz-recznie', 'Kucharz (ręcznie)', 'manual', $1)`, [COOK]);
  const before = await counts();

  await assert.rejects(importSnapshot(client, { manifest, model }), /allow-sample/);
  await assert.rejects(importSnapshot(client, { manifest, model, allowSample: true }), /ESCO_MANUAL_CONFLICT/);
  assert.deepEqual(await counts(), before, 'odmowa cofa cały import');

  const dry = await importSnapshot(client, { manifest, model, allowSample: true, manual: 'skip', dryRun: true });
  assert.equal(dry.occupations.inserted, 4);
  assert.deepEqual(await counts(), before, 'dry-run niczego nie zostawia');
  assert.equal((await one('select count(*)::int as n from esco_snapshots')).n, 0);

  const first = await importSnapshot(client, { manifest, model, allowSample: true, manual: 'skip' });
  assert.equal(first.status, 'new');
  assert.deepEqual([first.occupations.inserted, first.occupations.manualSkipped, first.skills.inserted], [4, 1, 22]);
  const cookRelations = model.relations.filter(r => r.occupationUri === COOK).length;
  assert.equal(first.relations.inserted, model.relations.length - cookRelations);
  assert.equal(first.relations.manualSkipped, cookRelations);
  const afterFirst = await counts();
  const manualRow = await one('select name, source, is_demo from occupations where esco_uri = $1', [COOK]);
  assert.deepEqual(manualRow, { name: 'Kucharz (ręcznie)', source: 'manual', is_demo: false }, 'ręczny wiersz nietknięty');
  assert.equal((await one('select count(*)::int as n from occupations where source = $1 and not is_demo', ['esco'])).n, 0, 'fragment = is_demo');

  // Ponowny import tego samego snapshotu: bez duplikatów i bez zmian.
  const second = await importSnapshot(client, { manifest, model, allowSample: true, manual: 'skip' });
  assert.equal(second.status, 'repeat');
  for (const part of [second.occupations, second.skills]) {
    assert.deepEqual([part.inserted, part.updated, part.labelsAdded, part.labelsRemoved], [0, 0, 0, 0]);
  }
  assert.deepEqual([second.relations.inserted, second.relations.updated], [0, 0]);
  assert.deepEqual(await counts(), afterFirst);
  assert.equal((await one('select import_count from esco_snapshots where id = $1', [manifest.snapshot])).import_count, 2);

  // Jawna decyzja overwrite przejmuje ręczny wiersz jako ESCO.
  const third = await importSnapshot(client, { manifest, model, allowSample: true, manual: 'overwrite' });
  assert.equal(third.occupations.updated, 1);
  assert.equal(third.relations.inserted, cookRelations);
  assert.equal((await one('select source, name from occupations where esco_uri = $1', [COOK])).source, 'esco');
  assert.equal((await one('select count(*)::int as n from occupation_skills')).n, model.relations.length);

  // Ta sama wersja/snapshot, inne pliki → odmowa.
  const tampered = structuredClone(manifest);
  tampered.files['skills_pl.csv'].sha256 = 'f'.repeat(64);
  await assert.rejects(importSnapshot(client, { manifest: tampered, model, allowSample: true, manual: 'overwrite' }), /ESCO_CHECKSUM_MISMATCH/);

  // Etykieta z fallbackiem: język → en → name.
  const label = await one(`select occupation_label(id, 'pl') as pl, occupation_label(id, 'ro') as ro,
    (select label from occupation_labels l where l.occupation_id = o.id and locale = 'en' and kind = 'preferred') as en
    from occupations o where esco_uri = $1`, [COOK]);
  assert.equal(label.ro, label.en);
  assert.notEqual(label.pl, null);
  console.log('ESCO import: dry-run, manual fail/skip/overwrite, idempotencja, checksum, fallback — PASS');
} finally {
  await client.end();
}
