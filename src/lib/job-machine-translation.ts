import { isLocale, type Locale } from '@/i18n/routing';
import type { JobDetail, JobListItem } from '@/lib/jobs';

/**
 * Nałożenie przekładu oferty na treść ze `get_public_job` (#33, 0159).
 *
 * Przekład jest pełnym zestawem pól jednej rewizji źródła (w języku oferty). Nakładamy go
 * tylko wtedy, gdy pasuje do tego, co pokazuje strona: rewizja jest w języku treści, a każda
 * lista ma w przekładzie tyle samo pozycji co w oryginale. Każda niezgodność = oryginał bez
 * zmian (nigdy strona z mieszanką języków). Pola spoza źródła oferty (opis firmy z profilu,
 * godziny z kolumny `jobs`) bez klucza w przekładzie zostają w oryginale.
 */

export type JobTranslationOrigin = 'ai' | 'manual';

export interface JobMachineTranslation {
  /** Język oryginału, z którego powstał przekład. */
  sourceLocale: Locale;
  /** `ai` = tłumaczenie automatyczne, `manual` = korekta ręczna. */
  origin: JobTranslationOrigin;
}

export interface MachineTranslationInput {
  source_locale: unknown;
  origin: unknown;
  fields: unknown;
}

const SCALARS = {
  title: 'title',
  description: 'description',
  working_hours: 'workingHours',
  shifts: 'shifts',
  company_description: 'companyDescription',
} as const satisfies Record<string, keyof JobDetail>;

const LISTS = {
  responsibilities: 'responsibilities',
  conditions: 'conditions',
  highlights: 'highlights',
  requirements_mandatory: 'requirementsMandatory',
  requirements_optional: 'requirementsOptional',
} as const satisfies Record<string, keyof JobDetail>;

type ListKey = (typeof LISTS)[keyof typeof LISTS];

function readList(fields: Record<string, unknown>, prefix: string): string[] | null {
  const items: Array<[number, string]> = [];
  for (const [key, value] of Object.entries(fields)) {
    if (!key.startsWith(`${prefix}.`)) continue;
    const index = key.slice(prefix.length + 1);
    if (!/^\d{1,4}$/.test(index) || typeof value !== 'string') return null;
    items.push([Number(index), value]);
  }
  items.sort((a, b) => a[0] - b[0]);
  // Indeksy muszą być ciągłe od 0 — inaczej przekład nie odpowiada liście oryginału.
  if (items.some(([index], position) => index !== position)) return null;
  return items.map(([, value]) => value);
}

export function applyJobMachineTranslation(
  job: JobDetail,
  input: MachineTranslationInput | null,
  requestedLocale: Locale,
): JobDetail {
  if (!input) return job;
  const { source_locale: sourceLocale, origin, fields } = input;
  if (typeof sourceLocale !== 'string' || !isLocale(sourceLocale)) return job;
  if (origin !== 'ai' && origin !== 'manual') return job;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return job;
  // Przekład tylko dla strony w innym języku niż treść, z rewizji w języku tej treści.
  if (sourceLocale === requestedLocale || job.contentLocale !== sourceLocale) return job;
  const record = fields as Record<string, unknown>;
  const title = record.title;
  if (typeof title !== 'string' || title.trim() === '') return job;

  const next: JobDetail = { ...job };
  for (const [key, target] of Object.entries(SCALARS)) {
    const value = record[key];
    if (value === undefined) continue;
    if (typeof value !== 'string') return job;
    next[target] = value;
  }
  for (const [prefix, target] of Object.entries(LISTS) as Array<[string, ListKey]>) {
    const list = readList(record, prefix);
    if (!list || list.length !== job[target].length) return job;
    next[target] = list;
  }
  return { ...next, machineTranslation: { sourceLocale, origin } };
}

/**
 * Nałożenie przekładu na kartę oferty (#33, 0160): tytuł i wyróżniki. Baza zwraca wiersz tylko
 * wtedy, gdy karta pokazuje treść w języku rewizji, więc tu sprawdzamy już tylko kształt:
 * niepusty tytuł i tyle samo wyróżników co w oryginale. Każda niezgodność = karta bez zmian.
 */
export function applyJobListMachineTranslation<T extends JobListItem>(
  job: T,
  input: MachineTranslationInput | null,
  requestedLocale: Locale,
): T {
  if (!input) return job;
  const { source_locale: sourceLocale, origin, fields } = input;
  if (typeof sourceLocale !== 'string' || !isLocale(sourceLocale)) return job;
  if (origin !== 'ai' && origin !== 'manual') return job;
  if (typeof fields !== 'object' || fields === null || Array.isArray(fields)) return job;
  if (sourceLocale === requestedLocale) return job;
  const record = fields as Record<string, unknown>;
  const title = record.title;
  if (typeof title !== 'string' || title.trim() === '') return job;
  const highlights = readList(record, 'highlights');
  if (!highlights || highlights.length !== job.highlights.length) return job;
  // #1223: przekład jest w języku strony — karta nie oznacza go innym `lang`.
  return { ...job, title, highlights, contentLocale: requestedLocale, machineTranslation: { sourceLocale, origin } };
}
