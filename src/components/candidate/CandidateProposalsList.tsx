'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useTranslations } from 'next-intl';
import { JobAvailabilityNote } from '@/components/candidate/JobAvailabilityNote';

import { Link } from '@/i18n/navigation';
import { ProposalStatusPill } from '@/components/candidate/ProposalStatusPill';
import { ProposalActions } from '@/components/candidate/ProposalActions';
import { canRespondToProposal, proposalAnchorId, proposalDisplayStatus } from '@/lib/candidate-offers';
import { loadMoreProposals } from '@/lib/actions/candidate-proposals';
import type { MyOffer, MyOffersPage } from '@/lib/data/candidate';
import {
  ACTION_ROW,
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  H2_EXTENDED,
  P_EXTENDED,
  PAPER,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

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
      <section className={cn(PAPER, 'px-[25px] py-[45px] text-center')}>
        <h2 className={H2_EXTENDED}>{t('proposalsEmptyTitle')}</h2>
        <p className={cn(P_EXTENDED, 'mt-2')}>{t('proposalsEmptyBody')}</p>
        <Link href="/candidate/profil" className={cn(BTN_PRIMARY, 'mt-5')}>
          {t('navProfile')}
        </Link>
      </section>
    );
  }

  return (
    <div className="min-w-0">
      <ul className="min-w-0">
        {items.map((offer: MyOffer) => {
          const date = formatDate(offer.date, locale);
          return (
            <li key={offer.id} id={proposalAnchorId(offer.id)} className={cn(PAPER, 'scroll-mt-24')}>
              <article className="min-w-0">
                {/* `proposalsScreen()`: `.section-head` — `.eyebrow` firma, h2, `.status`. */}
                <div className="flex min-w-0 flex-wrap items-start justify-between gap-5 max-[600px]:gap-2.5">
                  <div className="min-w-0 flex-1">
                    {offer.companyName ? <p className={cn(EYEBROW, 'normal-case')}>{offer.companyName}</p> : null}
                    {offer.slug ? (
                      <h2 className={cn(H2_EXTENDED, 'mt-0.5')}>
                        <Link
                          href={`/oferty-pracy/${offer.slug}`}
                          className="break-words hover:text-primary hover:underline"
                        >
                          {offer.jobTitle || t('applicationUnknownJob')}
                        </Link>
                      </h2>
                    ) : (
                      <h2 className={cn(H2_EXTENDED, 'mt-0.5')}>
                        {offer.jobTitle || t('applicationUnknownJob')}
                      </h2>
                    )}
                    <JobAvailabilityNote availability={offer.jobAvailability} className="mt-1.5" />
                    {date ? (
                      <p className={cn(P_EXTENDED, 'mt-1')}>{t('proposalSentOn', { date })}</p>
                    ) : null}
                  </div>
                  <ProposalStatusPill
                    status={proposalDisplayStatus(offer.status, offer.expiresAt, nowDate)}
                    className="shrink-0"
                  />
                </div>

                {/* Pusta treść = standardowe zaproszenie w języku KANDYDATA (Invariant #1, #289);
                    loader zamienia zapisany wcześniej szablon na ''. Własna treść bez zmian. */}
                <p className={cn(P_EXTENDED, 'mt-4 whitespace-pre-line break-words')}>
                  {offer.message || t('offerDefaultMessage')}
                </p>

                <div className={ACTION_ROW}>
                  <ProposalActions
                    offerId={offer.id}
                    expiresAt={offer.expiresAt}
                    jobTitle={offer.jobTitle || undefined}
                    initialCanRespond={canRespondToProposal(offer.status, offer.expiresAt, nowDate)}
                  />
                  <Link href="/candidate/wiadomosci" className={TEXT_LINK}>
                    {t('navMessages')}
                  </Link>
                </div>
              </article>
            </li>
          );
        })}
      </ul>
      {failed ? <p role="alert" className="mb-3 text-[15px] text-error">{t('proposalsMoreError')}</p> : null}
      {cursor ? (
        <button
          type="button"
          onClick={loadMore}
          disabled={pending}
          aria-busy={pending}
          className={BTN_SECONDARY}
        >
          {pending ? t('proposalsLoading') : failed ? t('candidateListRetry') : t('proposalsMore')}
        </button>
      ) : <p className="text-[13px] text-muted-foreground">{t('proposalsEnd')}</p>}
    </div>
  );
}
