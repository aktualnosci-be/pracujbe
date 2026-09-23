import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { CandidateApplicationsList } from "@/components/candidate/CandidateApplicationsList";
import { getMyApplicationsPage } from "@/lib/data/candidate";

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
    <div className="space-y-6">
      <header className="max-w-2xl space-y-2">
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("navApplications")}
        </h1>
        <p className="text-base text-muted-foreground">
          {t("applicationsIntro")}
        </p>
      </header>

      <CandidateApplicationsList locale={locale} initialPage={initialPage} />
    </div>
  );
}
