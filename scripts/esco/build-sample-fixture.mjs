/**
 * Buduje JAWNIE OZNACZONY fragment testowy ESCO v1.2.1 (#93) w formacie plików CSV
 * z paczki ESCO — z publicznego API ESCO (selectedVersion=v1.2.1), bo pełne paczki
 * pobiera się przez formularz z linkiem e-mail. To NIE jest oficjalny plik wydania:
 * służy testom pipeline'u. Pełny import: docs/ESCO.md.
 *
 * Użycie (sieć wymagana; za proxy: NODE_USE_ENV_PROXY=1):
 *   node scripts/esco/build-sample-fixture.mjs tests/fixtures/esco/esco-v1.2.1-sample
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { writeCsv } from './lib/csv.mjs';
import { ESCO_LOCALES, ESCO_VERSION, buildManifest, occupationsFile, relationsFile, skillsFile } from './lib/snapshot.mjs';

const API = 'https://ec.europa.eu/esco/api/resource';
// Zawody z grupy docelowej portalu (magazyn, transport, sprzątanie, gastronomia, budowa).
const OCCUPATIONS = [
  'http://data.europa.eu/esco/occupation/bea705fe-06ac-4147-b8e0-6e8ac1208d8f',
  'http://data.europa.eu/esco/occupation/45037d43-a8f5-4f46-b332-b2935bc305f4',
  'http://data.europa.eu/esco/occupation/7cb71c5f-c310-481c-b46b-d0044328758c',
  'http://data.europa.eu/esco/occupation/90f75f67-495d-49fa-ab57-2f320e251d7e',
  'http://data.europa.eu/esco/occupation/05f321f8-055b-407d-bf19-e0ddabda56b7',
];
const ESSENTIAL_PER_OCCUPATION = 3;
const OPTIONAL_PER_OCCUPATION = 2;

const OCCUPATION_HEADER = ['conceptType', 'conceptUri', 'iscoGroup', 'preferredLabel', 'altLabels', 'hiddenLabels', 'status', 'modifiedDate', 'regulatedProfessionNote', 'scopeNote', 'definition', 'inScheme', 'description', 'code'];
const SKILL_HEADER = ['conceptType', 'conceptUri', 'skillType', 'reuseLevel', 'preferredLabel', 'altLabels', 'hiddenLabels', 'status', 'modifiedDate', 'scopeNote', 'definition', 'inScheme', 'description'];
const RELATION_HEADER = ['occupationUri', 'occupationLabel', 'relationType', 'skillType', 'skillUri', 'skillLabel'];

async function resource(kind, uri) {
  const url = `${API}/${kind}?uri=${encodeURIComponent(uri)}&language=en&selectedVersion=${ESCO_VERSION}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`ESCO API ${response.status} dla ${uri}`);
  return response.json();
}

const tail = uri => uri.split('/').pop();
const byUri = (a, b) => (a.uri < b.uri ? -1 : 1);

const out = resolve(process.argv[2] ?? 'tests/fixtures/esco/esco-v1.2.1-sample');
await mkdir(out, { recursive: true });

const occupations = [];
const skills = new Map();
const relations = [];
for (const uri of OCCUPATIONS) {
  const occupation = await resource('occupation', uri);
  occupations.push(occupation);
  for (const [link, relationType, limit] of [['hasEssentialSkill', 'essential', ESSENTIAL_PER_OCCUPATION], ['hasOptionalSkill', 'optional', OPTIONAL_PER_OCCUPATION]]) {
    const picked = [...(occupation._links[link] ?? [])].filter(s => /\/esco\/skill\/[0-9a-f-]{36}$/.test(s.uri)).sort(byUri).slice(0, limit);
    for (const skill of picked) {
      if (!skills.has(skill.uri)) skills.set(skill.uri, await resource('skill', skill.uri));
      relations.push({ occupationUri: uri, skillUri: skill.uri, relationType });
    }
  }
}

const sortedSkills = [...skills.values()].sort(byUri);
for (const locale of ESCO_LOCALES) {
  const pref = concept => concept.preferredLabel?.[locale] ?? '';
  const alt = concept => (concept.alternativeLabel?.[locale] ?? []).join('\n');
  await writeFile(join(out, occupationsFile(locale)), writeCsv(OCCUPATION_HEADER, [...occupations].sort(byUri).map(o => ({
    conceptType: 'Occupation', conceptUri: o.uri, iscoGroup: o._links.broaderIscoGroup?.[0]?.code ?? '',
    preferredLabel: pref(o), altLabels: alt(o), status: o.status, code: o.code ?? '',
  }))));
  await writeFile(join(out, skillsFile(locale)), writeCsv(SKILL_HEADER, sortedSkills.map(s => ({
    conceptType: 'KnowledgeSkillCompetence', conceptUri: s.uri,
    skillType: tail(s._links.hasSkillType?.[0]?.uri ?? '') === 'knowledge' ? 'knowledge' : 'skill/competence',
    reuseLevel: tail(s._links.hasReuseLevel?.[0]?.uri ?? ''),
    preferredLabel: pref(s), altLabels: alt(s), status: s.status,
  }))));
}
const skillTypeOf = uri => (tail(skills.get(uri)._links.hasSkillType?.[0]?.uri ?? '') === 'knowledge' ? 'knowledge' : 'skill/competence');
for (const locale of ['en', 'pl']) {
  const label = (list, uri) => list.find(c => c.uri === uri)?.preferredLabel?.[locale] ?? '';
  await writeFile(join(out, relationsFile(locale)), writeCsv(RELATION_HEADER, [...relations]
    .sort((a, b) => (a.occupationUri + a.skillUri < b.occupationUri + b.skillUri ? -1 : 1))
    .map(r => ({ ...r, occupationLabel: label(occupations, r.occupationUri), skillType: skillTypeOf(r.skillUri), skillLabel: label(sortedSkills, r.skillUri) }))));
}

const manifest = await buildManifest(out, { snapshot: 'esco-v1.2.1-sample', sample: true });
await writeFile(`${out}.manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Fragment: ${occupations.length} zawodów, ${sortedSkills.length} umiejętności, ${relations.length} relacji → ${out}`);
