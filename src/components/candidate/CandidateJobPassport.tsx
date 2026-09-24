import * as React from 'react';
import { ArrowRight } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { SaveJobButton } from '@/components/candidate/SaveJobButton';
import { cn } from '@/lib/utils';

/**
 * Karta-paszport oferty w panelu kandydata (zapisane, polecane) — `peopleCard()` z prototypu
 * (`savedScreen()` renderuje `.p-job-grid` z `.job-passport`). Te same klasy `.pp-passport*`
 * co publiczna karta (`JobCard`), ale z polami dostępnymi w odczytach panelu: firma w miejscu
 * kategorii, tytuł, lokalizacja i opcjonalne drugie pole (np. dopasowanie). Przycisk zapisu
 * zachowuje cel 48 px (prototyp: 30 px). Teksty przychodzą przetłumaczone.
 */
export function CandidateJobPassport({
  job,
  labels,
  extra,
  children,
}: {
  job: { id: string; title: string; companyName: string; city: string; slug: string | null; saved: boolean };
  labels: { location: string; viewOffer: string };
  /** Drugie pole `.pp-passport-data` (np. „Dopasowanie”); bez niego jedna kolumna. */
  extra?: { label: string; value: React.ReactNode };
  /** Treść pod polami (np. pasek dopasowania). */
  children?: React.ReactNode;
}): React.JSX.Element {
  return (
    <article className="pp-passport h-full">
      <header>
        <p className="pp-passport-category break-words">{job.companyName}</p>
        <SaveJobButton jobId={job.id} initialSaved={job.saved} className="-my-2 -mr-2" />
      </header>
      <h3>
        {job.slug ? (
          <Link
            href={`/oferty-pracy/${job.slug}`}
            className="after:absolute after:inset-0 after:rounded-[24px] after:content-[''] focus-visible:outline-none focus-visible:after:ring-2 focus-visible:after:ring-ring focus-visible:after:ring-offset-2 max-[500px]:after:rounded-[20px]"
          >
            {job.title}
          </Link>
        ) : (
          job.title
        )}
      </h3>
      <dl className={cn('pp-passport-data mt-[19px]', extra ? 'pp-without-salary' : 'grid-cols-1')}>
        <div>
          <dt>{labels.location}</dt>
          <dd>{job.city}</dd>
        </div>
        {extra ? (
          <div>
            <dt>{extra.label}</dt>
            <dd>{extra.value}</dd>
          </div>
        ) : null}
      </dl>
      {children}
      <footer>
        <span className="pp-passport-brand" aria-hidden="true">
          pracuj<span className="pp-passport-dot">.be</span>
        </span>
        {/* Dekoracyjne jak w `JobCard`: link tytułu obejmuje całą kartę. */}
        {job.slug ? (
          <span className="pp-passport-cta" aria-hidden="true">
            {labels.viewOffer}
            <ArrowRight strokeWidth={1.5} />
          </span>
        ) : null}
      </footer>
    </article>
  );
}
