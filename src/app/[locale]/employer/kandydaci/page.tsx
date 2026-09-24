import { cn } from "@/lib/utils";
import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getTopMatchedCandidates } from "@/lib/data/employer";
import { MatchBar } from "@/components/ui/match-bar";
import { SendOfferButton } from "@/components/employer/SendOfferButton";
import {
  EYEBROW,
  H1_EXTENDED,
  INFO_VALUE,
  INTRO,
  H2_EXTENDED,
  INFO_LABEL,
  INFO_PAIRS,
  P_EXTENDED,
  PAPER,
  PANEL,
  PANEL_H2,
  PANEL_P,
  PROFILE_AVATAR,
} from '@/components/dashboard/panel-styles';

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
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return {
    title: t("navCandidates"),
    robots: { index: false, follow: false },
  };
}

export const dynamic = "force-dynamic";

/** Inicjały (placeholder avatara). */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((part) => part.charAt(0).toUpperCase()).join("") || "•";
}

export default async function EmployerCandidatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const td = await getTranslations({ locale, namespace: "dashboard" });

  let candidates: Awaited<ReturnType<typeof getTopMatchedCandidates>> = [];
  let readFailed = false;
  try {
    candidates = await getTopMatchedCandidates({ throwOnError: true });
  } catch {
    readFailed = true;
  }

  return (
    <div className="min-w-0">
      <div className="mb-[22px] min-w-0">
        <p className={EYEBROW}>
          {td("topMatched")}
        </p>
        <h1 className={H1_EXTENDED}>
          {td("navCandidates")}
        </h1>
        <p className={INTRO}>
          {td("candidatesIntro")}
        </p>
      </div>

      <section aria-label={td("topMatched")}>
        {readFailed ? (
          <div
            role="alert"
            className={PANEL}
          >
            <h2 className={PANEL_H2}>
              {td("candidatesReadErrorTitle")}
            </h2>
            <p className={`mt-2 ${PANEL_P}`}>
              {td("candidatesReadErrorBody")}
            </p>
          </div>
        ) : candidates.length === 0 ? (
          <div className={PANEL}>
            <h2 className={PANEL_H2}>
              {td("candidatesEmptyTitle")}
            </h2>
            <p className={`mt-2 ${PANEL_P}`}>
              {td("candidatesEmptyBody")}
            </p>
          </div>
        ) : (
          <ul className="grid min-w-0 gap-5 xl:grid-cols-2">
            {candidates.map((candidate) => (
              <li
                key={candidate.candidateId}
                className={cn(PAPER, "my-0 flex flex-col")}
              >
                <div className="min-w-0">
                  <span
                    className={PROFILE_AVATAR}
                    aria-hidden="true"
                  >
                    {initials(candidate.name || td("candidateFallback"))}
                  </span>
                  <div className="mt-3 min-w-0">
                    <h2 className={H2_EXTENDED}>
                      {candidate.name || td("candidateFallback")}
                    </h2>
                    {candidate.role ? (
                      <p className={`mt-3 break-words ${P_EXTENDED}`}>
                        {candidate.role}
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl className={INFO_PAIRS}>
                  <div className="min-w-0">
                    <dt className={INFO_LABEL}>
                      {td("colLocation")}
                    </dt>
                    <dd className={INFO_VALUE}>
                      {candidate.city || td("candidatesLocationUnknown")}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className={INFO_LABEL}>
                      {td("matchedCandidates")}
                    </dt>
                    <dd>
                      <MatchBar value={candidate.match} showLabel />
                    </dd>
                  </div>
                  <div className="col-span-2 min-w-0">
                    <dt className={INFO_LABEL}>
                      {td("offerMatchedJob")}
                    </dt>
                    <dd className={INFO_VALUE}>
                      {candidate.jobSlug ? (
                        <Link
                          href={`/oferty-pracy/${candidate.jobSlug}`}
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {candidate.jobTitle || td("applicationUnknownJob")}
                        </Link>
                      ) : (
                        candidate.jobTitle || td("applicationUnknownJob")
                      )}
                    </dd>
                  </div>
                </dl>
                <SendOfferButton
                  jobId={candidate.jobId}
                  candidateId={candidate.candidateId}
                  candidateName={candidate.name || td("candidateFallback")}
                  jobTitle={candidate.jobTitle}
                  jobSlug={candidate.jobSlug}
                  offerSentAt={candidate.offerSentAt}
                  className="mt-auto min-h-11 w-full sm:w-auto sm:self-start"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
