/**
 * Stan zapisanej oferty w panelu kandydata (`/candidate/zapisane`, migracja 0215).
 *
 * `get_saved_jobs_display` zwraca każdy własny zapis z `job_availability`; `slug` tylko dla
 * oferty publicznej. Ten moduł jest jedynym miejscem, które zamienia wiersz RPC na stan karty:
 * oferta niepubliczna NIGDY nie dostaje linku (strona publiczna odpowiedziałaby 404), a karta
 * pokazuje etykietę stanu i przycisk „Usuń z zapisanych”.
 *
 * Wartości zgodne z `candidate_job_availability` z historii zgłoszeń (PR #758) + `paused`.
 */

import { resolveDemoJobs } from '@/lib/data/demo';
import type { Locale } from '@/i18n/routing';

export type SavedJobAvailability = 'available' | 'closed' | 'expired' | 'paused' | 'unavailable';

export const SAVED_JOB_AVAILABILITY_VALUES: readonly SavedJobAvailability[] = [
  'available',
  'closed',
  'expired',
  'paused',
  'unavailable',
];

export interface SavedJob {
  id: string;
  /** Slug strony publicznej — WYŁĄCZNIE dla `availability === 'available'`. */
  slug: string | null;
  title: string;
  companyName: string;
  city: string;
  availability: SavedJobAvailability;
}

/** Klucz etykiety stanu w przestrzeni `dashboard` (oferta dostępna = brak etykiety). */
export const SAVED_JOB_STATE_KEYS: Record<Exclude<SavedJobAvailability, 'available'>, string> = {
  closed: 'savedStateClosed',
  expired: 'savedStateExpired',
  paused: 'savedStatePaused',
  unavailable: 'savedStateUnavailable',
};

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * Wiersz `get_saved_jobs_display` → karta. Nieznana wartość stanu = `unavailable` (bez linku).
 * Brak kolumny (baza sprzed 0215 zwraca tylko oferty publiczne) = `available`, gdy jest slug.
 */
export function toSavedJob(row: Record<string, unknown>): SavedJob {
  const rawSlug = str(row['slug']).trim();
  let availability: SavedJobAvailability;
  if ('job_availability' in row) {
    const value = row['job_availability'];
    availability = typeof value === 'string' && (SAVED_JOB_AVAILABILITY_VALUES as readonly string[]).includes(value)
      ? (value as SavedJobAvailability)
      : 'unavailable';
  } else {
    availability = rawSlug ? 'available' : 'unavailable';
  }
  // Link tylko do strony, która istnieje: oferta dostępna BEZ slugu też traci link.
  if (availability === 'available' && !rawSlug) availability = 'unavailable';
  return {
    id: str(row['id']),
    slug: availability === 'available' ? rawSlug : null,
    title: str(row['title']),
    companyName: str(row['company_name']),
    city: str(row['city']),
    availability,
  };
}

/** Dane DEMO (bez bazy): same oferty dostępne, jak dotychczas. */
export function demoSavedJobs(locale: Locale): SavedJob[] {
  return resolveDemoJobs(locale)
    .slice(0, 4)
    .map((job) => ({
      id: job.id,
      slug: job.slug || null,
      title: job.title,
      companyName: job.companyName,
      city: job.city,
      availability: job.slug ? 'available' : 'unavailable',
    }));
}

/**
 * Dane fikcyjne dla E2E (`PLAYWRIGHT_APPLICATIONS_FIXTURE=full`, tylko `next dev`): dwie oferty
 * dostępne i po jednej w każdym stanie niedostępnym — przez tę samą funkcję mapującą co baza.
 */
export function savedJobsFixture(locale: Locale): SavedJob[] {
  const jobs = resolveDemoJobs(locale);
  const states: SavedJobAvailability[] = ['available', 'closed', 'expired', 'available', 'paused', 'unavailable'];
  return states.map((state, index) => {
    const job = jobs[index % Math.max(jobs.length, 1)];
    return toSavedJob({
      id: `cccccccc-cccc-4ccc-8ccc-${String(index + 1).padStart(12, '0')}`,
      slug: state === 'available' ? job?.slug ?? '' : null,
      title: job?.title ?? '',
      company_name: job?.companyName ?? '',
      city: job?.city ?? '',
      job_availability: state,
    });
  });
}
