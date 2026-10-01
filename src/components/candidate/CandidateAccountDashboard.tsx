import { ArrowRight, BellRing, Bookmark, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { PanelStats } from '@/components/dashboard/PanelStats';
import {
  EMPTY,
  EYEBROW,
  H1,
  ICON_BOX,
  INTRO,
  PANEL,
  PANEL_H2,
  ROW,
  ROW_META,
  ROW_TITLE,
  SECTION_HEAD,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { DASH_GRID, DASH_GRID_MAIN, DASH_GRID_SIDE } from '@/components/candidate/candidate-styles';
import { CandidateSectionError } from '@/components/candidate/CandidateSectionError';
import { CandidateSavedSearchJobs } from '@/components/candidate/CandidateSavedSearchJobs';
import { CvUpload } from '@/components/candidate/CvUpload';
import { cn } from '@/lib/utils';
import { getCandidateAccountOverview, getSavedJobs } from '@/lib/data/candidate';
import { loadSavedSearchJobs } from '@/lib/data/candidate-saved-search-jobs';
import { loadMySavedSearches } from '@/lib/data/saved-searches';
import { loadCandidateFiles } from '@/lib/data/candidate-files';

/** Ile pozycji pokazuje pulpit (pełne listy na własnych stronach). */
const PREVIEW_LIMIT = 3;

/**
 * Pulpit konta w trybie ogłoszeniowym (#1142) — decyzja produktowa: portal ogłoszeniowy.
 * Konto służy do zapisanych ofert, zapisanych wyszukiwań i ustawień: bez kompletności profilu,
 * `MatchBar` i podglądów zgłoszeń/propozycji/wiadomości (ich loadery nie są wołane).
 * „Twoje pliki” (#1226, decyzja właściciela 29.09.2026): lista CV wgranych wcześniej (przed
 * trybem albo w RECRUITMENT) z pobraniem (link HMAC `prepareCvDownload`) i usunięciem —
 * `CvUpload` BEZ `allowUpload`, więc bez wgrywania. Sekcja tylko, gdy są pliki albo odczyt się
 * nie udał (konto bez plików nie widzi pustej sekcji).
 * Kalka `candidate()` z prototypu (`panel-styles`/`candidate-styles`), jak pulpit pełny.
 */
export async function CandidateAccountDashboard({ locale }: { locale: string }) {
  const [td, ts] = await Promise.all([
    getTranslations({ locale, namespace: 'dashboard' }),
    getTranslations({ locale, namespace: 'savedSearches' }),
  ]);
  const [overview, saved, searches, files] = await Promise.all([
    getCandidateAccountOverview(),
    getSavedJobs(locale),
    loadMySavedSearches(),
    loadCandidateFiles(),
  ]);

  // Oferty z zapisanych wyszukiwań: wyszukiwania już odczytane wyżej, drugi raz bazy nie pytamy.
  const searchJobs = await loadSavedSearchJobs(searches);
  const savedJobs = saved.status === 'ready' ? saved.jobs : null;
  const savedSearches = searches.status === 'ready' ? searches.searches : null;
  const alertsOn = savedSearches?.filter((s) => s.alertsEnabled).length ?? 0;
  const showFiles = files.status === 'error' || files.items.length > 0;

  return (
    <div className="min-w-0" data-testid="candidate-account-dashboard">
      <header className="min-w-0">
        <p className={EYEBROW}>{td('candidatePlaceEyebrow')}</p>
        <h1 className={H1}>
          {overview.firstName ? td('greeting', { name: overview.firstName }) : td('greetingNoName')}
        </h1>
        <p className={cn(INTRO, 'mb-[25px] mt-2')}>{td('accountIntro')}</p>
      </header>

      <PanelStats
        items={[
          {
            label: td('newJobs'),
            value: overview.newJobsCount ?? '—',
            sub: overview.newJobsCount === null ? td('candidateStatLoadError') : td('accountNewJobsSub'),
          },
          {
            label: td('navSaved'),
            value: savedJobs?.length ?? '—',
            sub: savedJobs === null ? td('candidateStatLoadError') : td('accountSavedJobsSub'),
          },
          {
            label: td('navSearches'),
            value: savedSearches?.length ?? '—',
            sub:
              savedSearches === null
                ? td('candidateStatLoadError')
                : td('accountSearchesSub', { count: alertsOn }),
          },
        ]}
      />

      <div className={DASH_GRID}>
        <div className={DASH_GRID_MAIN}>
          {/* Najnowsze oferty z zapisanych wyszukiwań (filtry kandydata, bez dopasowania). */}
          <CandidateSavedSearchJobs locale={locale} result={searchJobs} />

          <section className={PANEL} aria-labelledby="account-saved-jobs">
            <div className={SECTION_HEAD}>
              <h2 id="account-saved-jobs" className={PANEL_H2}>{td('navSaved')}</h2>
              <Link href="/candidate/zapisane" className={TEXT_LINK}>
                {td('seeAll')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {savedJobs === null ? (
              <CandidateSectionError message={td('savedError')} retry={td('savedRetry')} />
            ) : savedJobs.length === 0 ? (
              <p className={EMPTY}>{td('savedEmpty')}</p>
            ) : (
              <ul className="min-w-0">
                {savedJobs.slice(0, PREVIEW_LIMIT).map((job) => (
                  <li key={job.id} className={ROW}>
                    <span className={ICON_BOX} aria-hidden="true">
                      <Bookmark className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className={ROW_TITLE}>
                        {job.slug ? (
                          <Link href={`/oferty-pracy/${job.slug}`} className="break-words hover:text-primary hover:underline">
                            {job.title}
                          </Link>
                        ) : (
                          job.title
                        )}
                      </h3>
                      <p className={ROW_META}>
                        {job.companyName}
                        <span aria-hidden="true"> · </span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3 shrink-0" aria-hidden="true" />
                          {job.city}
                        </span>
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {showFiles ? (
            <section className={PANEL} aria-labelledby="account-files" data-testid="account-files">
              <div className={SECTION_HEAD}>
                <h2 id="account-files" className={PANEL_H2}>{td('accountFilesTitle')}</h2>
              </div>
              {/* Bez `allowUpload`: tylko pobranie i usunięcie istniejących plików (#1138/#1226). */}
              <CvUpload
                items={files.status === 'ready' ? files.items : []}
                loadFailed={files.status === 'error'}
              />
            </section>
          ) : null}
        </div>

        <div className={DASH_GRID_SIDE}>
          <section className={PANEL} aria-labelledby="account-saved-searches">
            <div className={SECTION_HEAD}>
              <h2 id="account-saved-searches" className={PANEL_H2}>{td('navSearches')}</h2>
              <Link href="/candidate/wyszukiwania" className={TEXT_LINK}>
                {ts('manage')}
                <ArrowRight className="size-3.5" aria-hidden="true" />
              </Link>
            </div>
            {savedSearches === null ? (
              <CandidateSectionError message={ts('loadError')} retry={ts('retry')} />
            ) : savedSearches.length === 0 ? (
              <p className={EMPTY}>{searches.status === 'ready' && searches.demo ? ts('demo') : ts('empty')}</p>
            ) : (
              <ul className="min-w-0">
                {savedSearches.slice(0, PREVIEW_LIMIT).map((search) => (
                  <li key={search.id} className={ROW}>
                    <span className={ICON_BOX} aria-hidden="true">
                      <BellRing className="size-4" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className={cn(ROW_TITLE, 'break-words')}>{search.name}</h3>
                      <p className={ROW_META}>
                        {search.alertsEnabled
                          ? search.frequency === 'weekly' ? ts('weekly') : ts('daily')
                          : td('accountAlertsOff')}
                      </p>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
