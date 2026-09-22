import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { ProposalStatusPill } from "@/components/candidate/ProposalStatusPill";
import { ProposalActions } from "@/components/candidate/ProposalActions";
import { canRespondToProposal, proposalDisplayStatus } from "@/lib/candidate-offers";
import { getMyOffers } from "@/lib/data/candidate";

/**
 * Panel kandydata — Propozycje pracy (makieta 04, nawigacja „Propozycje").
 *
 * Propozycje wysłane do kandydata (`offers`) czytane pod sesją (RLS `offers_select`); bez env dane
 * DEMO. NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Odpowiedź (przyjmij/odrzuć) przez
 * `ProposalActions` → Server Action `respondToOffer` (widoczne tylko dla statusów sent/viewed);
 * odnośnik do wiadomości dla kontynuacji rozmowy. Teksty z i18n (`dashboard`).
 */

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return {
    title: t("navProposals"),
    robots: { index: false, follow: false },
  };
}

/** Formatuje datę ISO do krótkiej postaci wg locale (bez rzucania na złej wartości). */
function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return "";
  return new Intl.DateTimeFormat(locale, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(ts);
}

export default async function CandidateProposalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "dashboard" });
  const offers = await getMyOffers(locale, true);
  const now = new Date();

  return (
    <div className="space-y-6">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("navProposals")}
        </h1>
        <p className="text-base text-muted-foreground">{t("proposalsIntro")}</p>
      </header>

      {offers.length === 0 ? (
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-foreground">
            {t("proposalsEmptyTitle")}
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            {t("proposalsEmptyBody")}
          </p>
          <Link
            href="/candidate/profil"
            className="mt-5 inline-flex min-h-12 items-center font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t("navProfile")}
          </Link>
        </section>
      ) : (
        <ul className="space-y-4">
          {offers.map((offer) => {
            const date = formatDate(offer.date, locale);
            return (
              <li
                key={offer.id}
                className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6"
              >
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
                          {offer.jobTitle || t("applicationUnknownJob")}
                        </Link>
                      ) : (
                        <p className="break-words text-xl font-semibold leading-snug text-foreground">
                          {offer.jobTitle || t("applicationUnknownJob")}
                        </p>
                      )}
                      {date ? (
                        <p className="text-sm text-muted-foreground">
                          {t("proposalSentOn", { date })}
                        </p>
                      ) : null}
                    </div>
                    <ProposalStatusPill
                      status={proposalDisplayStatus(offer.status, offer.expiresAt, now)}
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
                      initialCanRespond={canRespondToProposal(
                        offer.status,
                        offer.expiresAt,
                        now,
                      )}
                    />
                    <Link
                      href="/candidate/wiadomosci"
                      className="inline-flex min-h-12 items-center font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                    >
                      {t("navMessages")}
                    </Link>
                  </div>
                </article>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
