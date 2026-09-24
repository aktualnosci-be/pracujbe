/**
 * Import snapshotu ESCO do PostgreSQL (#93). Całość w JEDNEJ transakcji jako
 * service_role: przypięcie manifestu → zawody → umiejętności → relacje → zakończenie.
 * Błąd w dowolnym kroku cofa wszystko. `dryRun` wykonuje pełny import i ROLLBACK.
 */
import { manifestDigest } from './snapshot.mjs';

export const MANUAL_POLICIES = Object.freeze(['fail', 'skip', 'overwrite']);
const DEFAULT_BATCH = 500;

const chunks = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

const add = (total, part) => {
  for (const [key, value] of Object.entries(part)) total[key] = (total[key] ?? 0) + value;
  return total;
};

/** Wiersz przekazywany do RPC — tylko pola, które zna baza. */
export function occupationRow(concept) {
  return { uri: concept.uri, code: concept.code, iscoGroup: concept.iscoGroup, active: concept.active, name: concept.name, labels: concept.labels };
}
export function skillRow(concept) {
  return { uri: concept.uri, skillType: concept.skillType, reuseLevel: concept.reuseLevel, active: concept.active, name: concept.name, labels: concept.labels };
}

/**
 * @param {{query: Function}} client połączony klient (nie pula)
 * @param {{manifest: object, model: ReturnType<import('./snapshot.mjs').parseSnapshot>, manual?: string, dryRun?: boolean, batchSize?: number, allowSample?: boolean}} options
 */
export async function importSnapshot(client, { manifest, model, manual = 'fail', dryRun = false, batchSize = DEFAULT_BATCH, allowSample = false }) {
  if (!MANUAL_POLICIES.includes(manual)) throw new Error(`manual: dozwolone ${MANUAL_POLICIES.join(', ')}.`);
  if (manifest.sample && !allowSample) throw new Error('Manifest fragmentu testowego: import wymaga jawnego --allow-sample.');
  const started = performance.now();
  const timings = {};
  const lap = (name, since) => { timings[name] = Math.round(performance.now() - since); };
  await client.query('BEGIN');
  try {
    await client.query('SET LOCAL ROLE service_role');
    await client.query("SET LOCAL statement_timeout = '15min'");
    let t = performance.now();
    const { rows: [{ status }] } = await client.query(
      'SELECT public.esco_begin_snapshot($1::jsonb, $2) AS status',
      [JSON.stringify(manifest), manifestDigest(manifest)],
    );
    const occupations = {};
    const skills = {};
    const relations = {};
    t = performance.now();
    for (const batch of chunks(model.occupations.map(occupationRow), batchSize)) {
      const { rows: [row] } = await client.query('SELECT public.esco_upsert_occupations($1, $2::jsonb, $3) AS r', [manifest.snapshot, JSON.stringify(batch), manual]);
      add(occupations, row.r);
    }
    lap('occupationsMs', t);
    t = performance.now();
    for (const batch of chunks(model.skills.map(skillRow), batchSize)) {
      const { rows: [row] } = await client.query('SELECT public.esco_upsert_skills($1, $2::jsonb, $3) AS r', [manifest.snapshot, JSON.stringify(batch), manual]);
      add(skills, row.r);
    }
    lap('skillsMs', t);
    t = performance.now();
    for (const batch of chunks(model.relations, batchSize * 4)) {
      const { rows: [row] } = await client.query('SELECT public.esco_upsert_relations($1, $2::jsonb) AS r', [manifest.snapshot, JSON.stringify(batch)]);
      add(relations, row.r);
    }
    lap('relationsMs', t);
    const summary = { ...model.report };
    delete summary.missingTranslationUris;
    const { rows: [{ r: finish }] } = await client.query(
      'SELECT public.esco_finish_snapshot($1, $2::jsonb) AS r',
      [manifest.snapshot, JSON.stringify({ ...summary, importedAt: new Date().toISOString() })],
    );
    await client.query(dryRun ? 'ROLLBACK' : 'COMMIT');
    lap('totalMs', started);
    return { snapshot: manifest.snapshot, status, dryRun, occupations, skills, relations, finish, timings };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  }
}
