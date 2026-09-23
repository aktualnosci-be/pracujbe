import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { getTopMatchedCandidates } from "@/lib/data/employer";
import { MatchBar } from "@/components/ui/match-bar";
import { SendOfferButton } from "@/components/employer/SendOfferButton";

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
    <div className="space-y-7">
      <div className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-widest text-primary">
          {td("topMatched")}
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {td("navCandidates")}
        </h1>
        <p className="max-w-2xl text-base text-muted-foreground">
          {td("candidatesIntro")}
        </p>
      </div>

      <section aria-label={td("topMatched")}>
        {readFailed ? (
          <div
            role="alert"
            className="rounded-2xl border border-border bg-card p-6 sm:p-8"
          >
            <h2 className="text-xl font-semibold text-foreground">
              {td("candidatesReadErrorTitle")}
            </h2>
            <p className="mt-2 text-base text-muted-foreground">
              {td("candidatesReadErrorBody")}
            </p>
          </div>
        ) : candidates.length === 0 ? (
          <div className="rounded-2xl border border-border bg-card p-6 sm:p-8">
            <h2 className="text-xl font-semibold text-foreground">
              {td("candidatesEmptyTitle")}
            </h2>
            <p className="mt-2 text-base text-muted-foreground">
              {td("candidatesEmptyBody")}
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 xl:grid-cols-2">
            {candidates.map((candidate) => (
              <li
                key={candidate.candidateId}
                className="min-w-0 rounded-2xl border border-border bg-card p-5 shadow-sm sm:p-6"
              >
                <div className="flex min-w-0 items-start gap-4">
                  <span
                    className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-soft text-lg font-bold text-foreground ring-1 ring-inset ring-border"
                    aria-hidden="true"
                  >
                    {initials(candidate.name || td("candidateFallback"))}
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="break-words text-lg font-bold text-foreground">
                      {candidate.name || td("candidateFallback")}
                    </h2>
                    {candidate.role ? (
                      <p className="break-words text-base text-muted-foreground">
                        {candidate.role}
                      </p>
                    ) : null}
                  </div>
                </div>
                <dl className="mt-5 grid gap-4 border-t border-border pt-5 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="text-sm text-muted-foreground">
                      {td("colLocation")}
                    </dt>
                    <dd className="mt-1 break-words text-base font-medium text-foreground">
                      {candidate.city || td("candidatesLocationUnknown")}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="text-sm text-muted-foreground">
                      {td("matchedCandidates")}
                    </dt>
                    <dd className="mt-2">
                      <MatchBar value={candidate.match} showLabel />
                    </dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="text-sm text-muted-foreground">
                      {td("offerMatchedJob")}
                    </dt>
                    <dd className="mt-1 break-words text-base font-medium text-foreground">
                      {candidate.jobSlug ? (
                        <Link
                          href={`/oferty-pracy/${candidate.jobSlug}`}
                          className="text-primary hover:underline"
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
                  className="mt-5 min-h-11 w-full sm:w-auto"
                />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
