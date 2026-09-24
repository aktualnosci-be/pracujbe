import {
  JOB_ITEM_LIMITS,
  step1Schema,
  step2Schema,
  step3Schema,
  step4Schema,
  step5Schema,
  step6Schema,
  step7Schema,
  step8Schema,
  step9DraftSchema,
} from '@/lib/validation/job';
import { LANGUAGE_LEVELS } from '@/lib/validation/candidate';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import { findSensitiveData, IDENTIFIER_KINDS } from '@/lib/privacy/sensitive-data';
import {
  IMPORTABLE_FIELDS,
  rawExtractionSchema,
  type ImportableField,
  type RawExtraction,
} from '@/lib/ai-import/schema';

/**
 * Odpowiedź modelu → wartości kreatora (#465).
 *
 * Każdy krok przechodzi przez TEN SAM schemat Zod co ręczne wypełnianie (`stepNSchema`,
 * krok 9 w wariancie szkicu — bez zgody na publikację). Pole odrzucone przez schemat jest
 * czyszczone i oznaczane do sprawdzenia; pozostałe pola kroku zostają w formularzu. Do szkicu
 * w bazie trafiają wyłącznie kroki, które przeszły walidację w całości (`validSteps`).
 *
 * Do sprawdzenia (`review`) trafiają pola: wskazane przez model jako niepewne, obcięte,
 * zaokrąglone, odrzucone przez walidację — a przy podejrzeniu prompt injection wszystkie
 * wypełnione pola.
 *
 * Walidacja wyjścia pod kątem danych osób (#500, #495) — niezależnie od instrukcji w prompcie:
 *   - tekst z e-mailem lub telefonem nie trafia do formularza (pole tekstowe jest czyszczone,
 *     pozycja listy pomijana; pole oznaczone do sprawdzenia);
 *   - numer NISS/BIS, PESEL lub dokumentu w dowolnym polu → `sensitiveIdentifier`, a import
 *     jest odrzucany w całości (`runJobImport`).
 */

export interface ImportedWizardValues {
  title?: string;
  category?: string;
  occupation?: string;
  contractType?: string;
  workingHours?: string;
  shifts?: string;
  startImmediately?: boolean;
  startDate?: string;
  city?: string;
  region?: string;
  address?: string;
  remote?: boolean;
  salaryMin?: string;
  salaryMax?: string;
  currency?: string;
  salaryPeriod?: string;
  description?: string;
  responsibilities?: string[];
  requirementsMandatory?: string[];
  mandatorySkills?: string[];
  minExperienceYears?: string;
  requirementsOptional?: string[];
  skills?: string[];
  languages?: { language: string; level: string }[];
  requiredCertificates?: string[];
  requiresDrivingLicense?: boolean;
  conditions?: string[];
  benefits?: string[];
  accommodation?: boolean;
  transport?: boolean;
  companyDescription?: string;
}

export interface MappedImport {
  isJobListing: boolean;
  suspicious: boolean;
  /** #495: odpowiedź zawiera numer identyfikacyjny osoby/dokumentu — import odrzucany. */
  sensitiveIdentifier: boolean;
  sourceLanguage: string | null;
  values: ImportedWizardValues;
  review: ImportableField[];
  /** Dane kroków (1–9), które przeszły walidację w całości — do zapisu w szkicu. */
  validSteps: { step: number; data: unknown }[];
}

/** Waluty obsługiwane przez kreator (UI). */
const WIZARD_CURRENCIES = new Set(['EUR', 'PLN']);

/** Limity długości pól tekstowych — muszą odpowiadać schematom kroków. */
const TEXT_MAX: Partial<Record<ImportableField, number>> = {
  title: 120,
  occupation: 80,
  workingHours: 80,
  shifts: 120,
  city: 80,
  region: 80,
  address: 160,
  description: 5000,
  companyDescription: 3000,
};

const LIST_RULES: Partial<Record<ImportableField, { item: number; count: number }>> = {
  responsibilities: { item: JOB_ITEM_LIMITS.line, count: 20 },
  requirementsMandatory: { item: JOB_ITEM_LIMITS.requirement, count: 20 },
  mandatorySkills: { item: JOB_ITEM_LIMITS.skill, count: 30 },
  requirementsOptional: { item: JOB_ITEM_LIMITS.requirement, count: 20 },
  skills: { item: JOB_ITEM_LIMITS.skill, count: 30 },
  requiredCertificates: { item: JOB_ITEM_LIMITS.certificate, count: 20 },
  conditions: { item: JOB_ITEM_LIMITS.line, count: 20 },
  benefits: { item: JOB_ITEM_LIMITS.line, count: 20 },
};

/** Skraca tekst do limitu (na granicy słowa, gdy to możliwe). */
function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return (space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd();
}

function cleanText(value: string | null): string | null {
  if (value === null) return null;
  // Usuwamy znaki sterujące i niewidoczne znaki kierunku tekstu (maskowanie treści).
  const v = value
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f​-‏‪-‮⁦-⁩]/g, '')
    .trim();
  return v ? v : null;
}

/** Mapuje surowy obiekt odpowiedzi modelu na wartości kreatora. */
export function mapExtraction(raw: unknown): MappedImport {
  const parsed = rawExtractionSchema.safeParse(raw);
  const r: RawExtraction | null = parsed.success ? parsed.data : null;
  if (!r) {
    return {
      isJobListing: false,
      suspicious: false,
      sensitiveIdentifier: false,
      sourceLanguage: null,
      values: {},
      review: [],
      validSteps: [],
    };
  }

  const review = new Set<ImportableField>();
  const values: ImportedWizardValues = {};
  let sensitiveIdentifier = false;
  /** `true` = wartość może trafić do formularza (bez danych kontaktowych i identyfikatorów). */
  const isClean = (field: ImportableField, v: string): boolean => {
    const found = findSensitiveData(v);
    if (found.length === 0) return true;
    if (found.some((m) => IDENTIFIER_KINDS.includes(m.kind))) sensitiveIdentifier = true;
    review.add(field);
    return false;
  };
  const setText = (field: ImportableField & keyof ImportedWizardValues, rawValue: string | null): void => {
    const v = cleanText(rawValue);
    if (v === null) return;
    if (!isClean(field, v)) return;
    const max = TEXT_MAX[field];
    const out = max ? truncate(v, max) : v;
    if (out !== v) review.add(field);
    (values as Record<string, unknown>)[field] = out;
  };
  const setList = (field: ImportableField & keyof ImportedWizardValues, items: string[]): void => {
    const rule = LIST_RULES[field]!;
    const seen = new Set<string>();
    const out: string[] = [];
    for (const item of items) {
      const v = cleanText(item);
      if (v === null) continue;
      if (!isClean(field, v)) continue;
      if (v.length > rule.item) {
        review.add(field); // pozycja za długa — nie trafia na listę (#364)
        continue;
      }
      const key = v.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(v);
    }
    if (out.length > rule.count) review.add(field);
    const capped = out.slice(0, rule.count);
    if (capped.length > 0) (values as Record<string, unknown>)[field] = capped;
  };
  const setBool = (field: ImportableField & keyof ImportedWizardValues, v: boolean | null): void => {
    if (v !== null) (values as Record<string, unknown>)[field] = v;
  };
  const setInt = (field: 'salaryMin' | 'salaryMax' | 'minExperienceYears', v: number | null): void => {
    if (v === null || v < 0) {
      if (v !== null) review.add(field);
      return;
    }
    const rounded = Math.round(v);
    if (rounded !== v) review.add(field); // np. stawka 17,50 → 18 (kolumna całkowita)
    values[field] = String(rounded);
  };

  setText('title', r.title);
  if (r.category) values.category = r.category;
  setText('occupation', r.occupation);
  if (r.contractType) values.contractType = r.contractType;
  setText('workingHours', r.workingHours);
  setText('shifts', r.shifts);
  setBool('startImmediately', r.startImmediately);
  if (r.startDate) values.startDate = r.startDate.trim();
  setText('city', r.city);
  setText('region', r.region);
  setText('address', r.address);
  setBool('remote', r.remote);
  setInt('salaryMin', r.salaryMin);
  setInt('salaryMax', r.salaryMax);
  if (r.currency) {
    const c = r.currency.trim().toUpperCase();
    if (WIZARD_CURRENCIES.has(c)) values.currency = c;
    else review.add('currency');
  }
  if (r.salaryPeriod) values.salaryPeriod = r.salaryPeriod;
  setText('description', r.description);
  setList('responsibilities', r.responsibilities);
  setList('requirementsMandatory', r.requirementsMandatory);
  setList('mandatorySkills', r.mandatorySkills);
  setInt('minExperienceYears', r.minExperienceYears);
  setList('requirementsOptional', r.requirementsOptional);
  setList('skills', r.skills);
  const languages: { language: string; level: string }[] = [];
  for (const l of r.languages) {
    const name = cleanText(l.language);
    if (!name || !isClean('languages', name)) continue;
    const level = l.level && (LANGUAGE_LEVELS as readonly string[]).includes(l.level) ? l.level : null;
    if (!level) review.add('languages');
    if (!languages.some((x) => x.language.toLowerCase() === name.toLowerCase())) {
      languages.push({ language: name, level: level ?? 'basic' });
    }
  }
  if (languages.length > 0) values.languages = languages.slice(0, 10);
  setList('requiredCertificates', r.requiredCertificates);
  setBool('requiresDrivingLicense', r.requiresDrivingLicense);
  setList('conditions', r.conditions);
  setList('benefits', r.benefits);
  setBool('accommodation', r.accommodation);
  setBool('transport', r.transport);
  setText('companyDescription', r.companyDescription);

  for (const f of r.uncertainFields) {
    if ((IMPORTABLE_FIELDS as readonly string[]).includes(f) && f in values) review.add(f as ImportableField);
  }

  // Walidacja krok po kroku tymi samymi schematami co kreator.
  const validSteps: { step: number; data: unknown }[] = [];
  for (const def of STEP_DEFS) {
    let data = def.build(values);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const result = def.schema.safeParse(data);
      if (result.success) {
        validSteps.push({ step: def.step, data: result.data });
        break;
      }
      const bad = new Set(result.error.issues.map((i) => String(i.path[0] ?? '')));
      let removed = false;
      for (const field of bad) {
        if (!(IMPORTABLE_FIELDS as readonly string[]).includes(field)) continue;
        if (field in values) {
          delete (values as Record<string, unknown>)[field];
          review.add(field as ImportableField);
          removed = true;
        }
      }
      if (!removed) break; // brakuje pola wymaganego — krok zostaje do uzupełnienia ręcznie
      data = def.build(values);
    }
  }

  if (r.suspiciousInstructions) {
    for (const f of IMPORTABLE_FIELDS) if (f in values) review.add(f);
  }

  return {
    isJobListing: r.isJobListing,
    suspicious: r.suspiciousInstructions,
    sensitiveIdentifier,
    sourceLanguage: cleanText(r.sourceLanguage)?.slice(0, 8) ?? null,
    values,
    review: IMPORTABLE_FIELDS.filter((f) => review.has(f)),
    // Podejrzenie prompt injection: nic nie trafia do bazy bez przejrzenia przez człowieka —
    // formularz jest wypełniony, ale szkic zapisze dopiero „Dalej" po sprawdzeniu pól.
    validSteps: r.suspiciousInstructions || sensitiveIdentifier ? [] : validSteps,
  };
}

/** '' / brak → undefined (pole opcjonalne), jak `buildStepData` w kreatorze. */
const opt = (v: string | undefined): string | undefined => (v && v.trim() ? v : undefined);
const optNum = (v: string | undefined): number | undefined => (v && v.trim() ? Number(v) : undefined);

const STEP_DEFS: {
  step: number;
  schema: { safeParse: (d: unknown) => { success: true; data: unknown } | { success: false; error: { issues: { path: (string | number)[] }[] } } };
  build: (v: ImportedWizardValues) => unknown;
}[] = [
  {
    step: 1,
    schema: step1Schema,
    build: (v) => ({ title: v.title, category: v.category, occupation: v.occupation }),
  },
  {
    step: 2,
    schema: step2Schema,
    build: (v) => ({
      contractType: v.contractType,
      workingHours: v.workingHours,
      shifts: opt(v.shifts),
      startImmediately: v.startImmediately ?? false,
      startDate: opt(v.startDate),
    }),
  },
  {
    step: 3,
    schema: step3Schema,
    build: (v) => ({ city: v.city, region: v.region, address: opt(v.address), remote: v.remote ?? false }),
  },
  {
    step: 4,
    schema: step4Schema,
    build: (v) => ({
      salaryMin: optNum(v.salaryMin),
      salaryMax: optNum(v.salaryMax),
      currency: v.currency ?? 'EUR',
      salaryPeriod: v.salaryPeriod ?? 'month',
    }),
  },
  {
    step: 5,
    schema: step5Schema,
    build: (v) => ({ description: v.description, responsibilities: v.responsibilities ?? [] }),
  },
  {
    step: 6,
    schema: step6Schema,
    build: (v) => ({
      requirementsMandatory: v.requirementsMandatory ?? [],
      mandatorySkills: v.mandatorySkills ?? [],
      minExperienceYears: optNum(v.minExperienceYears),
    }),
  },
  {
    step: 7,
    schema: step7Schema,
    build: (v) => ({
      requirementsOptional: v.requirementsOptional ?? [],
      skills: v.skills ?? [],
      languages: v.languages ?? [],
      requiredCertificates: v.requiredCertificates ?? [],
      requiresDrivingLicense: v.requiresDrivingLicense ?? false,
      noLanguageRequired: false,
    }),
  },
  {
    step: 8,
    schema: step8Schema,
    build: (v) => ({
      conditions: v.conditions ?? [],
      benefits: v.benefits ?? [],
      accommodation: v.accommodation ?? false,
      transport: v.transport ?? false,
    }),
  },
  {
    step: 9,
    schema: step9DraftSchema,
    // E-mail kontaktowy nie jest importowany (#500) — pracodawca wpisuje go ręcznie.
    build: (v) => ({ companyDescription: v.companyDescription }),
  },
];

/**
 * Kroki, które przeszły walidację → JEDNA treść `p_content` dla `save_job_draft` (0083). RPC ma
 * semantykę patch (zapisuje tylko obecne klucze), więc złączenie kroków = jeden zapis w jednej
 * transakcji zamiast kilku częściowych.
 */
export function buildImportDraftContent(
  validSteps: { step: number; data: unknown }[],
): Record<string, unknown> | null {
  const merged: Record<string, unknown> = {};
  for (const { step, data } of validSteps) {
    const content = buildDraftStepContent(step, data);
    if (!content) continue;
    for (const [key, value] of Object.entries(content)) {
      if ((key === 'job' || key === 'translation') && value && typeof value === 'object') {
        merged[key] = { ...((merged[key] as Record<string, unknown> | undefined) ?? {}), ...value };
      } else {
        merged[key] = value;
      }
    }
  }
  return Object.keys(merged).length > 0 ? merged : null;
}
