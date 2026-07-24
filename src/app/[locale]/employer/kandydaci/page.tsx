import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getTopMatchedCandidates } from '@/lib/data/employer';
import { MatchBar } from '@/components/ui/match-bar';
import { SendOfferButton } from '@/components/employer/SendOfferButton';

/**
 * Panel pracodawcy — Kandydaci (makieta 05, kolumna „Top dopasowani"), na REALNYCH danych.
 *
 * Lista najlepiej dopasowanych kandydatów (`getTopMatchedCandidates` pod sesją/RLS; tylko dla
 * firmy zweryfikowanej). Każdy wiersz: inicjały, imię/rola/miasto, pasek dopasowania (MatchBar)
 * i idempotentna wysyłka propozycji (SendOfferButton → `sendOffer`). Bez env — dane DEMO.
 * NOINDEX dziedziczone z layoutu panelu.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navCandidates'),
    robots: { index: false, follow: false },
  };
}

export const dynamic = 'force-dynamic';

/** Inicjały (placeholder avatara). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join('') || '•';
}

export default async function EmployerCandidatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: 'dashboard' });

  const candidates = await getTopMatchedCandidates();

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{td('navCandidates')}</h1>
      </div>

      <section className="rounded-lg border border-border bg-card">
        <div className="border-b border-border p-4 sm:px-5">
          <h2 className="text-base font-semibold text-foreground">{td('topMatched')}</h2>
        </div>

        {candidates.length === 0 ? (
          <p className="p-6 text-center text-sm text-muted-foreground">{td('emptyState')}</p>
        ) : (
          <ul className="divide-y divide-border">
            {candidates.map((candidate) => (
              <li
                key={candidate.candidateId}
                className="flex flex-wrap items-center gap-3 p-4 sm:px-5"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-soft text-sm font-semibold text-muted-foreground ring-1 ring-inset ring-border"
                  aria-hidden="true"
                >
                  {initials(candidate.name || td('candidateFallback'))}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">
                    {candidate.name || td('candidateFallback')}
                  </p>
                  {candidate.role ? (
                    <p className="truncate text-sm text-muted-foreground">{candidate.role}</p>
                  ) : null}
                  {candidate.city ? (
                    <p className="truncate text-xs text-muted-foreground">{candidate.city}</p>
                  ) : null}
                </div>
                <MatchBar value={candidate.match} showLabel className="w-40 shrink-0" />
                <SendOfferButton
                  jobId={candidate.jobId}
                  candidateId={candidate.candidateId}
                  className="w-full sm:w-auto"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
