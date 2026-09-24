import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CandidateApplicationsList } from "@/components/candidate/CandidateApplicationsList";
import { getMyApplicationsPage } from "@/lib/data/candidate";
import { CandidatePageHeader } from "@/components/candidate/CandidatePageHeader";

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
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const initialPage = await getMyApplicationsPage(locale);

  return (
    <div className="min-w-0">
      <CandidatePageHeader
        eyebrow={t("candidatePlaceEyebrow")}
        title={t("navApplications")}
        intro={t("applicationsIntro")}
      />

      <CandidateApplicationsList locale={locale} initialPage={initialPage} />
    </div>
  );
}
