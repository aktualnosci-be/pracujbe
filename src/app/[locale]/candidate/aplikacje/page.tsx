import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CandidateApplicationsList } from "@/components/candidate/CandidateApplicationsList";
import { getMyApplicationsPage } from "@/lib/data/candidate";
import { CandidatePageHeader } from "@/components/candidate/CandidatePageHeader";
import { CandidateApplicationsFilter } from "@/components/candidate/CandidateApplicationsFilter";
import { APPLICATION_FILTER_PARAM, parseApplicationFilter } from "@/lib/candidate-application-filter";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return {
    title: t("navApplications"),
    robots: { index: false, follow: false },
  };
}

export default async function CandidateApplicationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "dashboard" });
  // #809: filtr etapu z URL (`?etap=`); nieznana wartość = wszystkie zgłoszenia.
  const filter = parseApplicationFilter((await searchParams)[APPLICATION_FILTER_PARAM]);
  const initialPage = await getMyApplicationsPage(locale, null, filter);
  // Bez żadnego zgłoszenia filtr nic nie wnosi — zostaje sam pusty stan z linkiem do ofert.
  const showFilter = filter !== null || initialPage.items.length > 0;

  return (
    <div className="min-w-0">
      <CandidatePageHeader
        eyebrow={t("candidatePlaceEyebrow")}
        title={t("navApplications")}
        intro={t("applicationsIntro")}
      />

      {showFilter ? <CandidateApplicationsFilter current={filter} /> : null}
      <CandidateApplicationsList key={filter ?? "all"} locale={locale} initialPage={initialPage} filter={filter} />
    </div>
  );
}
