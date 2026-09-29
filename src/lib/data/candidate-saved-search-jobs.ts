/**
 * Pulpit kandydata w trybie ogłoszeniowym (decyzja produktowa: portal ogłoszeniowy): najnowsze
 * oferty z ZAPISANYCH WYSZUKIWAŃ kandydata — bez profilu, dopasowania i wyniku. Filtry to
 * kanoniczny adres listy zapisany z wyszukiwaniem (`saved_searches.query`), parsowany tym samym
 * `parseJobListQuery` co lista `/oferty-pracy` i publiczne `get_public_jobs` (kolejność jak na
 * liście publicznej: najnowsze; firmy zablokowane przez kandydata baza pomija dla `candidateId`).
 *
 * Awaria odczytu wyszukiwań albo ofert = jawny `error` (z ponowieniem w UI), nigdy pusty wynik.
 */

import { readCandidateViewerId } from '@/lib/auth/candidate-viewer';
import { captureError } from '@/lib/error-report';
import { getJobs, type JobListItem } from '@/lib/jobs';
import { parseJobListQuery, type FlatSearchParams } from '@/lib/job-list-query';
import { loadMySavedSearches, type SavedSearch, type SavedSearchesLoad } from '@/lib/data/saved-searches';

/** Ile najnowszych zapisanych wyszukiwań bierzemy pod uwagę (koszt: jedno zapytanie na wyszukiwanie). */
export const DASHBOARD_SEARCHES_LIMIT = 3;
/** Ile ofert łącznie pokazuje pulpit. */
export const DASHBOARD_SEARCH_JOBS_LIMIT = 3;

export interface SavedSearchJob {
  id: string;
  slug: string;
  title: string;
  companyName: string;
  city: string;
  publishedAt: string;
  /** Wyszukiwanie, z którego pochodzi oferta (pierwsze, które ją zwróciło). */
  searchId: string;
}

/** Wyszukiwanie wzięte pod uwagę — do linku „Pokaż oferty” w języku zapisu (#823). */
export interface DashboardSearch {
  id: string;
  name: string;
  query: string;
  locale: SavedSearch['locale'];
}

export type SavedSearchJobsLoad =
  /** Brak zapisanych wyszukiwań — UI zachęca do zapisania. */
  | { status: 'none' }
  | { status: 'ok'; jobs: SavedSearchJob[]; searches: DashboardSearch[] }
  | { status: 'error' };

/** Adres zapisanego wyszukiwania (`?a=b&…`) → płaskie parametry, jak `describeSavedSearchFilters`. */
function flatParams(query: string): FlatSearchParams {
  const flat: FlatSearchParams = {};
  if (!query.startsWith('?')) return flat;
  for (const [key, value] of new URLSearchParams(query.slice(1))) {
    if (flat[key] === undefined) flat[key] = value;
  }
  return flat;
}

function byNewest(a: JobListItem, b: JobListItem): number {
  // Remis daty: większy id pierwszy (deterministycznie); ta sama oferta z dwóch wyszukiwań = 0,
  // więc sort stabilny zostawia ją przy pierwszym wyszukiwaniu.
  return Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.id.localeCompare(a.id);
}

/**
 * `preloaded` — już odczytana lista wyszukiwań (pulpit konta czyta ją sam), żeby nie pytać bazy drugi raz.
 */
export async function loadSavedSearchJobs(preloaded?: SavedSearchesLoad): Promise<SavedSearchJobsLoad> {
  try {
    const saved = preloaded ?? (await loadMySavedSearches());
    if (saved.status === 'error') return { status: 'error' };
    const searches = saved.searches.slice(0, DASHBOARD_SEARCHES_LIMIT);
    if (searches.length === 0) return { status: 'none' };

    // #97: zalogowany kandydat nie widzi ofert firm, które zablokował (filtruje baza).
    const viewer = { candidateId: await readCandidateViewerId() };
    const perSearch = await Promise.all(
      searches.map(async (search) => {
        const { filterParams } = parseJobListQuery(flatParams(search.query), search.locale);
        const result = await getJobs(
          { ...filterParams, sort: 'newest', page: 1, pageSize: DASHBOARD_SEARCH_JOBS_LIMIT },
          viewer,
        );
        return result.jobs.map((job) => ({ job, searchId: search.id }));
      }),
    );

    const seen = new Set<string>();
    const jobs = perSearch
      .flat()
      .sort((a, b) => byNewest(a.job, b.job))
      .filter(({ job }) => (seen.has(job.id) ? false : (seen.add(job.id), true)))
      .slice(0, DASHBOARD_SEARCH_JOBS_LIMIT)
      .map(({ job, searchId }) => ({
        id: job.id,
        slug: job.slug,
        title: job.title,
        companyName: job.companyName,
        city: job.city,
        publishedAt: job.publishedAt,
        searchId,
      }));

    return {
      status: 'ok',
      jobs,
      searches: searches.map(({ id, name, query, locale }) => ({ id, name, query, locale })),
    };
  } catch (error) {
    captureError(error, { area: 'candidate.loadSavedSearchJobs' });
    return { status: 'error' };
  }
}
