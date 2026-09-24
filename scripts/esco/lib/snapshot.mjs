/**
 * Snapshot ESCO v1.2.1 (#93): manifest z sumami kontrolnymi, weryfikacja plików
 * i parsowanie oficjalnych CSV do modelu importu. Bez dostępu do bazy i sieci.
 *
 * Wersja jest przypięta w kodzie (ESCO_VERSION). Manifest przypina zawartość
 * plików (SHA-256 + rozmiar); baza przypina manifest przy pierwszym imporcie
 * (esco_begin_snapshot) — ta sama wersja z innymi plikami jest odrzucana.
 * Języki: tylko języki portalu (PL/NL/FR/EN, decyzja właściciela).
 */
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsvObjects } from './csv.mjs';

export const ESCO_VERSION = 'v1.2.1';
export const ESCO_LOCALES = Object.freeze(['pl', 'nl', 'fr', 'en']);
/** Język, z którego pochodzi `name` (fallback) i obowiązkowy plik relacji. */
export const ESCO_FALLBACK_LOCALE = 'en';
export const MAX_LABEL_LENGTH = 1000;

const URI = {
  occupation: /^http:\/\/data\.europa\.eu\/esco\/occupation\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  skill: /^http:\/\/data\.europa\.eu\/esco\/skill\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
};
const SNAPSHOT_ID = /^[a-z0-9][a-z0-9.-]{2,62}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const SKILL_TYPES = new Set(['skill/competence', 'knowledge']);
const REUSE_LEVELS = new Set(['transversal', 'cross-sector', 'sector-specific', 'occupation-specific']);
const RELATION_TYPES = new Set(['essential', 'optional']);

export const OCCUPATION_COLUMNS = ['conceptType', 'conceptUri', 'iscoGroup', 'preferredLabel', 'altLabels', 'status', 'code'];
export const SKILL_COLUMNS = ['conceptType', 'conceptUri', 'skillType', 'reuseLevel', 'preferredLabel', 'altLabels', 'status'];
export const RELATION_COLUMNS = ['occupationUri', 'relationType', 'skillType', 'skillUri'];

export const occupationsFile = locale => `occupations_${locale}.csv`;
export const skillsFile = locale => `skills_${locale}.csv`;
export const relationsFile = locale => `occupationSkillRelations_${locale}.csv`;

/** Pliki wymagane w każdym manifeście. Relacje innych języków są opcjonalne (porównywane). */
export function requiredFiles(locales = ESCO_LOCALES) {
  return [...locales.flatMap(locale => [occupationsFile(locale), skillsFile(locale)]), relationsFile(ESCO_FALLBACK_LOCALE)];
}

const sha256 = data => createHash('sha256').update(data).digest('hex');

/** Kanoniczny skrót manifestu: niezależny od kolejności kluczy w JSON. */
export function manifestDigest(manifest) {
  const files = Object.keys(manifest.files).sort().map(name => [name, manifest.files[name].sha256, manifest.files[name].bytes]);
  return sha256(JSON.stringify([manifest.snapshot, manifest.escoVersion, manifest.sample, [...manifest.locales].sort(), files]));
}

/**
 * Sprawdza kształt manifestu. Wersja musi być przypiętą ESCO_VERSION, języki = języki portalu.
 * @returns {{snapshot:string, escoVersion:string, sample:boolean, locales:string[], files:Record<string,{sha256:string,bytes:number}>}}
 */
export function validateManifest(manifest) {
  if (typeof manifest !== 'object' || manifest === null) throw new Error('Manifest: oczekiwano obiektu JSON.');
  const { snapshot, escoVersion, sample, locales, files } = manifest;
  if (typeof snapshot !== 'string' || !SNAPSHOT_ID.test(snapshot)) throw new Error('Manifest: nieprawidłowy identyfikator snapshotu.');
  if (escoVersion !== ESCO_VERSION) throw new Error(`Manifest: wersja ESCO musi być ${ESCO_VERSION}.`);
  if (typeof sample !== 'boolean') throw new Error('Manifest: pole sample musi być true/false.');
  if (sample !== snapshot.endsWith('-sample')) throw new Error('Manifest: fragment testowy musi mieć identyfikator z sufiksem -sample (i tylko on).');
  if (!Array.isArray(locales) || [...locales].sort().join() !== [...ESCO_LOCALES].sort().join()) {
    throw new Error(`Manifest: języki muszą być dokładnie ${ESCO_LOCALES.join(', ')}.`);
  }
  if (typeof files !== 'object' || files === null || Array.isArray(files)) throw new Error('Manifest: brak listy plików.');
  for (const [name, entry] of Object.entries(files)) {
    if (!/^[A-Za-z]+_[a-z]{2}\.csv$/.test(name)) throw new Error(`Manifest: nieprawidłowa nazwa pliku ${name}.`);
    if (!entry || !SHA256.test(entry.sha256) || !Number.isSafeInteger(entry.bytes) || entry.bytes <= 0) {
      throw new Error(`Manifest: nieprawidłowa suma lub rozmiar dla ${name}.`);
    }
  }
  const missing = requiredFiles(locales).filter(name => !files[name]);
  if (missing.length) throw new Error(`Manifest: brak plików: ${missing.join(', ')}.`);
  return manifest;
}

async function readRegularFile(path, name) {
  const info = await lstat(path).catch(() => null);
  if (!info) throw new Error(`Brak pliku ${name} w katalogu snapshotu.`);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${name}: wymagany zwykły plik bez dowiązania.`);
  return readFile(path);
}

/** Buduje manifest z pobranych plików (pierwsze przypięcie snapshotu). */
export async function buildManifest(dir, { snapshot, sample = false }) {
  const files = {};
  const names = [...requiredFiles(), ...ESCO_LOCALES.filter(l => l !== ESCO_FALLBACK_LOCALE).map(relationsFile)];
  for (const name of names) {
    const optional = !requiredFiles().includes(name);
    const info = await lstat(join(dir, name)).catch(() => null);
    if (!info && optional) continue;
    const data = await readRegularFile(join(dir, name), name);
    files[name] = { sha256: sha256(data), bytes: data.length };
  }
  return validateManifest({ snapshot, escoVersion: ESCO_VERSION, sample, locales: [...ESCO_LOCALES], files });
}

/**
 * Czyta pliki z manifestu i sprawdza SHA-256 + rozmiar. Niezgodność = odmowa importu.
 * @returns {Promise<Map<string,string>>} nazwa → treść UTF-8
 */
export async function readVerifiedFiles(dir, manifest) {
  validateManifest(manifest);
  const out = new Map();
  for (const [name, entry] of Object.entries(manifest.files).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const data = await readRegularFile(join(dir, name), name);
    if (data.length !== entry.bytes || sha256(data) !== entry.sha256) {
      throw new Error(`Suma kontrolna ${name} nie zgadza się z manifestem — plik zmieniony albo z innego wydania.`);
    }
    const text = new TextDecoder('utf-8', { fatal: true }).decode(data);
    out.set(name, text);
  }
  return out;
}

function cleanLabel(value, where) {
  const label = value.normalize('NFC').trim();
  if (label.length > MAX_LABEL_LENGTH) throw new Error(`${where}: etykieta dłuższa niż ${MAX_LABEL_LENGTH} znaków.`);
  return label;
}

function labelsOf(row, where) {
  const preferred = cleanLabel(row.preferredLabel ?? '', where);
  const seen = new Set(preferred ? [preferred] : []);
  const alternative = [];
  for (const raw of (row.altLabels ?? '').split(/\r?\n/)) {
    const label = cleanLabel(raw, where);
    if (label && !seen.has(label)) {
      seen.add(label);
      alternative.push(label);
    }
  }
  alternative.sort();
  return { preferred: preferred || null, alternative };
}

function mergeField(concept, field, value, where) {
  if (!value) return;
  if (concept[field] && concept[field] !== value) throw new Error(`${where}: pole ${field} różni się między językami.`);
  concept[field] = value;
}

function parseConcepts(kind, files, locales) {
  const concepts = new Map();
  const columns = kind === 'occupation' ? OCCUPATION_COLUMNS : SKILL_COLUMNS;
  const conceptType = kind === 'occupation' ? 'Occupation' : 'KnowledgeSkillCompetence';
  for (const locale of locales) {
    const name = kind === 'occupation' ? occupationsFile(locale) : skillsFile(locale);
    const rows = parseCsvObjects(files.get(name), columns);
    const seen = new Set();
    rows.forEach((row, index) => {
      const where = `${name}:${index + 2}`;
      if (row.conceptType !== conceptType) throw new Error(`${where}: oczekiwano conceptType=${conceptType}.`);
      if (!URI[kind].test(row.conceptUri)) throw new Error(`${where}: nieprawidłowe URI ESCO.`);
      if (seen.has(row.conceptUri)) throw new Error(`${where}: powtórzone URI.`);
      seen.add(row.conceptUri);
      const concept = concepts.get(row.conceptUri) ?? { uri: row.conceptUri, status: null, labels: {} };
      mergeField(concept, 'status', row.status.trim(), where);
      if (kind === 'occupation') {
        mergeField(concept, 'code', row.code.trim(), where);
        mergeField(concept, 'iscoGroup', row.iscoGroup.trim(), where);
      } else {
        const skillType = row.skillType.trim();
        const reuseLevel = row.reuseLevel.trim();
        if (skillType && !SKILL_TYPES.has(skillType)) throw new Error(`${where}: nieznany skillType.`);
        if (reuseLevel && !REUSE_LEVELS.has(reuseLevel)) throw new Error(`${where}: nieznany reuseLevel.`);
        mergeField(concept, 'skillType', skillType, where);
        mergeField(concept, 'reuseLevel', reuseLevel, where);
      }
      concept.labels[locale] = labelsOf(row, where);
      concepts.set(row.conceptUri, concept);
    });
  }
  return [...concepts.values()].sort((a, b) => (a.uri < b.uri ? -1 : 1)).map(concept => ({
    uri: concept.uri,
    status: concept.status,
    active: concept.status === 'released',
    ...(kind === 'occupation'
      ? { code: concept.code ?? null, iscoGroup: concept.iscoGroup ?? null }
      : { skillType: concept.skillType ?? null, reuseLevel: concept.reuseLevel ?? null }),
    name: concept.labels[ESCO_FALLBACK_LOCALE]?.preferred ?? null,
    labels: concept.labels,
  }));
}

function parseRelations(files, locales, occupations, skills) {
  const occupationUris = new Set(occupations.map(c => c.uri));
  const skillUris = new Set(skills.map(c => c.uri));
  let reference = null;
  let referenceName = null;
  for (const locale of [ESCO_FALLBACK_LOCALE, ...locales.filter(l => l !== ESCO_FALLBACK_LOCALE)]) {
    const name = relationsFile(locale);
    if (!files.has(name)) continue;
    const pairs = new Map();
    parseCsvObjects(files.get(name), RELATION_COLUMNS).forEach((row, index) => {
      const where = `${name}:${index + 2}`;
      if (!occupationUris.has(row.occupationUri)) throw new Error(`${where}: relacja do nieznanego zawodu.`);
      if (!skillUris.has(row.skillUri)) throw new Error(`${where}: relacja do nieznanej umiejętności.`);
      if (!RELATION_TYPES.has(row.relationType)) throw new Error(`${where}: relationType musi być essential/optional.`);
      const key = `${row.occupationUri} ${row.skillUri}`;
      if (pairs.has(key) && pairs.get(key) !== row.relationType) throw new Error(`${where}: sprzeczny typ relacji.`);
      pairs.set(key, row.relationType);
    });
    const list = [...pairs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([key, relationType]) => {
      const [occupationUri, skillUri] = key.split(' ');
      return { occupationUri, skillUri, relationType };
    });
    if (reference === null) {
      reference = list;
      referenceName = name;
    } else if (JSON.stringify(list) !== JSON.stringify(reference)) {
      throw new Error(`${name}: relacje różnią się od ${referenceName}.`);
    }
  }
  if (reference === null) throw new Error(`Brak pliku ${relationsFile(ESCO_FALLBACK_LOCALE)}.`);
  return reference;
}

/** Raport brakujących tłumaczeń: brak etykiety preferowanej w danym języku. */
export function missingTranslations(concepts, locales = ESCO_LOCALES) {
  return Object.fromEntries(locales.map(locale => [
    locale,
    concepts.filter(concept => !concept.labels[locale]?.preferred).map(concept => concept.uri),
  ]));
}

/**
 * Parsuje zweryfikowane pliki do deterministycznego modelu (posortowane po URI).
 * @param {Map<string,string>} files
 */
export function parseSnapshot(files, locales = ESCO_LOCALES) {
  const occupations = parseConcepts('occupation', files, locales);
  const skills = parseConcepts('skill', files, locales);
  for (const concept of [...occupations, ...skills]) {
    if (!concept.name) throw new Error(`${concept.uri}: brak etykiety preferowanej ${ESCO_FALLBACK_LOCALE} (wymagana jako fallback).`);
  }
  const relations = parseRelations(files, locales, occupations, skills);
  const missing = { occupation: missingTranslations(occupations, locales), skill: missingTranslations(skills, locales) };
  return {
    occupations,
    skills,
    relations,
    report: {
      occupations: occupations.length,
      skills: skills.length,
      relations: relations.length,
      essential: relations.filter(r => r.relationType === 'essential').length,
      optional: relations.filter(r => r.relationType === 'optional').length,
      missingTranslations: Object.fromEntries(
        Object.entries(missing).map(([kind, byLocale]) => [kind, Object.fromEntries(Object.entries(byLocale).map(([l, uris]) => [l, uris.length]))]),
      ),
      missingTranslationUris: missing,
    },
  };
}
