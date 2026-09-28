import { ArrowRight, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import type { SavedSearchJobsLoad } from '@/lib/data/candidate-saved-search-jobs';
import {
  BTN_PRIMARY,
  ICON_BOX,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';

/**
 * „Nowe oferty z Twoich wyszukiwań” na pulpicie kandydata w trybie ogłoszeniowym (decyzja
 * produktowa: portal ogłoszeniowy) — w miejscu dawnych polecanych ofert. Bez wyniku i dopasowania:
 * oferty zwrócone przez publiczną listę dla filtrów zapisanych wyszukiwań. `result === null` =
 * tryb rekrutacyjny (sekcji nie ma). Trzy różne stany: brak zapisanych wyszukiwań (zachęta),
 * błąd odczytu (ponowienie) i brak ofert.
 */

/** Inicjały firmy (placeholder logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export async function CandidateSavedSearchJobs({
  locale,
  result,
}: {
  locale: string;
  result: SavedSearchJobsLoad | null;
}) {
  if (result === null) return null;
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const ts = await getTranslations({ locale, namespace: 'savedSearches' });
  const tc = await getTranslations({ locale, namespace: 'common' });

  return (
    <section className={PANEL} data-testid="candidate-saved-search-jobs">
      <div className={SECTION_HEAD}>
        <h2 className={PANEL_H2}>{td('savedSearchJobsTitle')}</h2>
        <Link href="/candidate/wyszukiwania" className={TEXT_LINK}>
          {td('navSearches')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {result.status === 'error' ? (
        <CandidateSectionError message={td('savedSearchJobsError')} retry={tc('retry')} />
      ) : result.status === 'none' ? (
        <div className="min-w-0">
          <p className="text-sm leading-[1.7] text-muted-foreground">{td('savedSearchJobsNone')}</p>
          <Link href="/oferty-pracy" className={`${BTN_PRIMARY} mt-4`}>
            {td('savedSearchJobsCta')}
          </Link>
        </div>
      ) : (
        <>
          {result.jobs.length === 0 ? (
            <p className="text-sm leading-[1.7] text-muted-foreground">{td('savedSearchJobsNoResults')}</p>
          ) : (
            <ul className="min-w-0">
              {result.jobs.map((job) => {
                const search = result.searches.find((item) => item.id === job.searchId);
                const searchName = search ? search.name || ts('defaultName') : '';
                return (
                  <li key={job.id} className={ROW}>
                    <span className={ICON_BOX} aria-hidden="true">
                      {initials(job.companyName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className={ROW_TITLE}>
                        <Link
                          href={`/oferty-pracy/${encodeURIComponent(job.slug)}`}
                          className="break-words hover:text-primary hover:underline"
                        >
                          {job.title}
                        </Link>
                      </h3>
                      <p className={ROW_META}>
                        {job.companyName}
                        <span aria-hidden="true"> · </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          {job.city}
                        </span>
                      </p>
                      {searchName ? (
                        <p className={ROW_META}>{td('savedSearchJobsFrom', { name: searchName })}</p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {/* „Pokaż oferty” — lista w języku zapisu wyszukiwania (#823), jak w /candidate/wyszukiwania. */}
          <ul className="mt-2 flex min-w-0 flex-col gap-2 border-t border-[color:var(--pp-line)] pt-[19px]">
            {result.searches.map((search) => (
              <li key={search.id} className="min-w-0">
                <Link
                  href={`/oferty-pracy${search.query}`}
                  locale={search.locale}
                  className={`${TEXT_LINK} break-words`}
                >
                  {td('savedSearchJobsShow', { name: search.name || ts('defaultName') })}
                  <ArrowRight className="size-3.5 shrink-0" aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
