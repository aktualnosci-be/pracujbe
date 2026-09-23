import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CandidateProposalsList } from "@/components/candidate/CandidateProposalsList";
import { getMyOffersPage } from "@/lib/data/candidate";

/**
 * Panel kandydata — Propozycje pracy (makieta 04, nawigacja „Propozycje").
 *
 * Propozycje wysłane do kandydata (`offers`) czytane pod sesją (RLS `offers_select`); bez env dane
 * DEMO. NOINDEX + guard dziedziczone z `candidate/layout.tsx`. Pełna historia jest stronicowana
 * (`CandidateProposalsList` + `loadMoreProposals`, #245); błąd pierwszego odczytu obsługuje
 * `error.tsx`. Odpowiedź (przyjmij/odrzuć) przez `ProposalActions` → Server Action `respondToOffer`
 * (widoczne tylko dla statusów sent/viewed). Teksty z i18n (`dashboard`).
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

export default async function CandidateProposalsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "dashboard" });
  const initialPage = await getMyOffersPage(locale);

  return (
    <div className="space-y-6">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("navProposals")}
        </h1>
        <p className="text-base text-muted-foreground">{t("proposalsIntro")}</p>
      </header>

      <CandidateProposalsList
        locale={locale}
        initialPage={initialPage}
        now={new Date().toISOString()}
      />
    </div>
  );
}
