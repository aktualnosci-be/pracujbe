import { ArrowRight, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { MatchBar } from '@/components/ui/match-bar';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import type { RecommendedJob } from '@/lib/data/candidate';
import {
  EMPTY,
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
 * „Polecane oferty pracy” na pulpicie kandydata (wynik dopasowania + `MatchBar`). Wydzielone
 * z `candidate/page.tsx` (#1139), żeby trasa aktywna w trybie ogłoszeniowym nie importowała
 * `MatchBar`. `recommended === null` = tryb ogłoszeniowy: portal nie wybiera ofert na
 * podstawie profilu, sekcji nie ma (bez sekcji zastępczej).
 */

/** Inicjały firmy (placeholder logo). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export async function CandidateRecommendedPreview({
  locale,
  recommended,
}: {
  locale: string;
  recommended: RecommendedJob[] | null;
}) {
  if (recommended === null) return null;
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const tj = await getTranslations({ locale, namespace: 'jobs' });

  return (
    <section className={PANEL}>
      <div className={SECTION_HEAD}>
        <h2 className={PANEL_H2}>{td('recommendedJobs')}</h2>
        <Link href="/candidate/oferty-polecane" className={TEXT_LINK}>
          {td('seeAll')}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </Link>
      </div>
      {recommended.length === 0 ? (
        <p className={EMPTY}>{tj('empty')}</p>
      ) : (
        <ul className="min-w-0">
          {recommended.map((job) => (
            <li key={job.id} className={ROW}>
              <span className={ICON_BOX} aria-hidden="true">
                {initials(job.companyName)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-start justify-between gap-2">
                  <div className="min-w-0">
                    {job.slug ? (
                      <h3 className={ROW_TITLE}>
                        <Link
                          href={`/oferty-pracy/${job.slug}`}
                          className="break-words hover:text-primary hover:underline"
                        >
                          {job.title}
                        </Link>
                      </h3>
                    ) : (
                      <h3 className={ROW_TITLE}>{job.title}</h3>
                    )}
                    <p className={ROW_META}>
                      {job.companyName}
                      <span aria-hidden="true"> · </span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3 shrink-0" aria-hidden="true" />
                        {job.city}
                      </span>
                    </p>
                  </div>
                  <SaveJobButton jobId={job.id} initialSaved={job.saved} className="-mt-1" />
                </div>
                {job.match !== null ? (
                  <span className="mt-2.5 flex min-w-[7rem] max-w-[14rem] items-center gap-2">
                    <span className="w-9 shrink-0 text-right text-xs font-semibold tabular-nums text-success-text">
                      {job.match}%
                    </span>
                    <MatchBar value={job.match} className="flex-1" />
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
