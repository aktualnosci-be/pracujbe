'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { ProposalStatusPill } from '@/components/candidate/ProposalStatusPill';
import { ProposalActions } from '@/components/candidate/ProposalActions';
import { canRespondToProposal, proposalDisplayStatus } from '@/lib/candidate-offers';
import { loadMoreProposals } from '@/lib/actions/candidate-proposals';
import type { MyOffer, MyOffersPage } from '@/lib/data/candidate';

/** Formatuje datę ISO do krótkiej postaci wg locale (bez rzucania na złej wartości). */
function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts)
    ? ''
    : new Intl.DateTimeFormat(locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(ts);
}

/**
 * Pełna historia propozycji kandydata (#245): pierwsza strona z SSR, kolejne przez Server Action
 * `loadMoreProposals` (kursor `created_at` + UUID). Błąd kolejnej strony nie usuwa wczytanych kart.
 * `now` przychodzi z serwera, aby stan „wygasła” był taki sam w SSR i po hydratacji.
 */
export function CandidateProposalsList({
  locale,
  initialPage,
  now,
}: {
  locale: string;
  initialPage: MyOffersPage;
  now: string;
}) {
  const t = useTranslations('dashboard');
  const [items, setItems] = useState(initialPage.items);
  const [cursor, setCursor] = useState(initialPage.nextCursor);
  const [failed, setFailed] = useState(false);
  const [pending, startTransition] = useTransition();
  const generation = useRef(0);
  const nowDate = new Date(now);

  // Po odpowiedzi na propozycję ProposalActions odświeża trasę; zsynchronizuj karty z nowym SSR.
  useEffect(() => {
    generation.current += 1;
    setItems(initialPage.items);
    setCursor(initialPage.nextCursor);
    setFailed(false);
  }, [initialPage]);

  const loadMore = () => {
    if (!cursor || pending) return;
    const startedAt = generation.current;
    setFailed(false);
    startTransition(async () => {
      try {
        const result = await loadMoreProposals(locale, cursor);
        if (generation.current !== startedAt) return;
        if (result.status === 'error') {
          setFailed(true);
          return;
        }
        // Odświeżenie trasy mogło w międzyczasie zwrócić już widoczny rekord.
        setItems((current) => {
          const seen = new Set(current.map((item) => item.id));
          return [...current, ...result.page.items.filter((item) => !seen.has(item.id))];
        });
        setCursor(result.page.nextCursor);
      } catch {
        if (generation.current === startedAt) setFailed(true);
      }
    });
  };

  if (items.length === 0) {
    return (
      <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
        <h2 className="text-xl font-semibold text-foreground">{t('proposalsEmptyTitle')}</h2>
        <p className="mt-2 text-base text-muted-foreground">{t('proposalsEmptyBody')}</p>
        <Link
          href="/candidate/profil"
          className="mt-5 inline-flex min-h-12 items-center font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {t('navProfile')}
        </Link>
      </section>
    );
  }

  return (
    <div className="space-y-5">
      <ul className="space-y-4">
        {items.map((offer: MyOffer) => {
          const date = formatDate(offer.date, locale);
          return (
            <li key={offer.id} className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6">
              <article className="space-y-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    {offer.companyName ? (
                      <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                        {offer.companyName}
                      </p>
                    ) : null}
                    {offer.slug ? (
                      <Link
                        href={`/oferty-pracy/${offer.slug}`}
                        className="break-words text-xl font-semibold leading-snug text-foreground hover:text-primary hover:underline"
                      >
                        {offer.jobTitle || t('applicationUnknownJob')}
                      </Link>
                    ) : (
                      <p className="break-words text-xl font-semibold leading-snug text-foreground">
                        {offer.jobTitle || t('applicationUnknownJob')}
                      </p>
                    )}
                    {date ? (
                      <p className="text-sm text-muted-foreground">{t('proposalSentOn', { date })}</p>
                    ) : null}
                  </div>
                  <ProposalStatusPill
                    status={proposalDisplayStatus(offer.status, offer.expiresAt, nowDate)}
                    className="shrink-0"
                  />
                </div>

                {offer.message ? (
                  <p className="whitespace-pre-line break-words border-l-4 border-primary bg-soft px-4 py-3 text-base leading-relaxed text-foreground">
                    {offer.message}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center gap-4 border-t border-border pt-4">
                  <ProposalActions
                    offerId={offer.id}
                    expiresAt={offer.expiresAt}
                    jobTitle={offer.jobTitle || undefined}
                    initialCanRespond={canRespondToProposal(offer.status, offer.expiresAt, nowDate)}
                  />
                  <Link
                    href="/candidate/wiadomosci"
                    className="inline-flex min-h-12 items-center font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                  >
                    {t('navMessages')}
                  </Link>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {failed ? <p role="alert" className="text-base text-error">{t('proposalsMoreError')}</p> : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          aria-busy={pending}
          className="inline-flex min-h-12 max-w-full items-center whitespace-normal break-words rounded-xl border border-border bg-card px-5 text-left font-semibold text-foreground hover:bg-soft focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:opacity-60"
        >
          {pending ? t('proposalsLoading') : failed ? t('candidateListRetry') : t('proposalsMore')}
        </button>
      ) : <p className="text-sm text-muted-foreground">{t('proposalsEnd')}</p>}
    </div>
  );
}
