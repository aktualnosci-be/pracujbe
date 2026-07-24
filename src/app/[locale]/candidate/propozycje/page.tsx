import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { StatusPill } from '@/components/ui/status-pill';
import { ProposalActions } from '@/components/candidate/ProposalActions';
import { getMyOffers } from '@/lib/data/candidate';

/**
 * Panel kandydata — Propozycje pracy (makieta 04, nawigacja „Propozycje").
 *
 * Propozycje wysłane do kandydata (`offers`) czytane pod sesją (RLS `offers_select`); bez env dane
 * DEMO. NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Odpowiedź (przyjmij/odrzuć) przez
 * `ProposalActions` → Server Action `respondToOffer` (widoczne tylko dla statusów sent/viewed);
 * odnośnik do wiadomości dla kontynuacji rozmowy. Teksty z i18n (`dashboard`).
 */

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'dashboard' });
  return {
    title: t('navProposals'),
    robots: { index: false, follow: false },
  };
}

/** Formatuje datę ISO do krótkiej postaci wg locale (bez rzucania na złej wartości). */
function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return '';
  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(ts);
}

export default async function CandidateProposalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: 'dashboard' });
  const offers = await getMyOffers(locale);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight text-foreground">{t('navProposals')}</h1>

      {offers.length === 0 ? (
        <section className="rounded-lg border border-border bg-card">
          <p className="p-4 text-sm text-muted-foreground sm:px-5">{t('emptyState')}</p>
        </section>
      ) : (
        <ul className="space-y-4">
          {offers.map((offer) => {
            const date = formatDate(offer.date, locale);
            return (
              <li key={offer.id} className="rounded-lg border border-border bg-card p-4 sm:p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {offer.slug ? (
                      <Link
                        href={`/oferty-pracy/${offer.slug}`}
                        className="truncate text-sm font-semibold text-foreground hover:text-accent hover:underline"
                      >
                        {offer.jobTitle || '—'}
                      </Link>
                    ) : (
                      <p className="truncate text-sm font-semibold text-foreground">
                        {offer.jobTitle || '—'}
                      </p>
                    )}
                    <p className="mt-0.5 truncate text-sm text-muted-foreground">
                      {offer.companyName ? (
                        <>
                          {offer.companyName} <span className="text-border">·</span> {date}
                        </>
                      ) : (
                        date
                      )}
                    </p>
                  </div>
                  <StatusPill status={offer.status} className="shrink-0" />
                </div>

                {offer.message ? (
                  <p className="mt-3 whitespace-pre-line text-sm text-foreground">{offer.message}</p>
                ) : null}

                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <ProposalActions offerId={offer.id} status={offer.status} />
                  <Link
                    href="/candidate/wiadomosci"
                    className="text-sm font-medium text-accent hover:underline"
                  >
                    {t('navMessages')}
                  </Link>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
