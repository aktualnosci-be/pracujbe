import { redactSensitiveData, type RedactionResult } from '@/lib/privacy/sensitive-data';

/**
 * Minimalizacja materiału importu ogłoszenia PRZED wysłaniem do modelu (#500, #495).
 *
 * Bezpieczeństwo nie opiera się na instrukcji dla modelu:
 *   - z JSON-LD zostaje wyłącznie `JobPosting` z listy dozwolonych pól (bez `url`,
 *     `identifier`, `applicationContact`, `contactPoint`, `sameAs`, logo itp.);
 *   - z tekstu strony usuwamy e-maile, telefony, NISS/BIS, PESEL i numery dokumentów
 *     (`redactSensitiveData` — deterministycznie, z sumami kontrolnymi);
 *   - do promptu trafia tylko nazwa hosta źródła — bez ścieżki, parametrów, fragmentu
 *     i danych logowania (tokeny w URL nie wychodzą poza serwer).
 *
 * Zrzutu ekranu nie da się tak zredagować (brak lokalnego OCR) — tam działa walidacja
 * wyjścia modelu (`map.ts`) i odmowa importu przy numerze identyfikacyjnym.
 */

/** Pola `JobPosting` potrzebne do wypełnienia kreatora. */
const JOB_POSTING_FIELDS = [
  'title',
  'description',
  'datePosted',
  'validThrough',
  'employmentType',
  'workHours',
  'baseSalary',
  'estimatedSalary',
  'jobLocation',
  'jobLocationType',
  'applicantLocationRequirements',
  'qualifications',
  'responsibilities',
  'skills',
  'experienceRequirements',
  'educationRequirements',
  'jobBenefits',
  'incentiveCompensation',
  'industry',
  'occupationalCategory',
  'jobStartDate',
  'jobImmediateStart',
  'hiringOrganization',
] as const;

/** Zagnieżdżone obiekty — tylko pola opisowe (adres miejsca pracy, nazwa firmy, kwoty). */
const NESTED_FIELDS = new Set([
  '@type',
  'name',
  'description',
  'address',
  'addressLocality',
  'addressRegion',
  'postalCode',
  'addressCountry',
  'streetAddress',
  'currency',
  'value',
  'minValue',
  'maxValue',
  'unitText',
  'monthsOfExperience',
  'credentialCategory',
]);

const MAX_JSON_LD_CHARS = 8000;

function stripTags(value: string): string {
  return value.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function pickNested(node: unknown, depth: number): unknown {
  if (depth > 4) return undefined;
  if (typeof node === 'string') return stripTags(node);
  if (typeof node === 'number' || typeof node === 'boolean') return node;
  if (Array.isArray(node)) {
    const items = node.slice(0, 20).map((n) => pickNested(n, depth + 1)).filter((n) => n !== undefined);
    return items.length > 0 ? items : undefined;
  }
  if (node && typeof node === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (!NESTED_FIELDS.has(k)) continue;
      const picked = pickNested(v, depth + 1);
      if (picked !== undefined) out[k] = picked;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

function isJobPosting(node: Record<string, unknown>): boolean {
  const t = node['@type'];
  return t === 'JobPosting' || (Array.isArray(t) && t.includes('JobPosting'));
}

function findJobPostings(node: unknown, found: Record<string, unknown>[], depth = 0): void {
  if (depth > 4 || found.length >= 3 || !node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const n of node) findJobPostings(n, found, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  if (isJobPosting(obj)) {
    found.push(obj);
    return;
  }
  if (Array.isArray(obj['@graph'])) findJobPostings(obj['@graph'], found, depth + 1);
}

/**
 * Surowy blok JSON-LD → zminimalizowany `JobPosting` (JSON) albo `null`, gdy blok nie zawiera
 * ogłoszenia lub nie jest poprawnym JSON-em (np. `Organization` z danymi kontaktowymi).
 */
export function minimizeJobPostingJsonLd(raw: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  const postings: Record<string, unknown>[] = [];
  findJobPostings(parsed, postings);
  if (postings.length === 0) return null;
  const minimized = postings.map((posting) => {
    const out: Record<string, unknown> = { '@type': 'JobPosting' };
    for (const field of JOB_POSTING_FIELDS) {
      if (!(field in posting)) continue;
      const value = field === 'hiringOrganization' ? pickNested(posting[field], 1) : pickNested(posting[field], 0);
      if (value !== undefined) out[field] = value;
    }
    return out;
  });
  const json = JSON.stringify(minimized.length === 1 ? minimized[0] : minimized);
  return json.slice(0, MAX_JSON_LD_CHARS);
}

/** Tekst strony/ogłoszenia bez danych kontaktowych i identyfikatorów osób. */
export function minimizeListingText(text: string): RedactionResult {
  return redactSensitiveData(text);
}

/**
 * Identyfikator źródła dla promptu: sama nazwa hosta (bez schematu, ścieżki, parametrów,
 * fragmentu i danych logowania). Niepoprawny adres → pusty napis.
 */
export function listingSourceLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/[^a-z0-9.\-]/gi, '');
  } catch {
    return '';
  }
}
