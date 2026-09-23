import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { ApplicationActions } from "@/components/candidate/ApplicationActions";
import { getMyApplications } from "@/lib/data/candidate";

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

function formatDate(iso: string, locale: string): string {
  const ts = Date.parse(iso);
  return Number.isNaN(ts)
    ? ""
    : new Intl.DateTimeFormat(locale, {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      }).format(ts);
}

export default async function CandidateApplicationsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const t = await getTranslations({ locale, namespace: "dashboard" });
  const applications = await getMyApplications(locale, true);

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

      {applications.length === 0 ? (
        <section className="rounded-2xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-foreground">
            {t("applicationsEmptyTitle")}
          </h2>
          <p className="mt-2 text-base text-muted-foreground">
            {t("applicationsEmptyBody")}
          </p>
          <Link
            href="/oferty-pracy"
            className="mt-5 inline-flex min-h-12 items-center rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
          >
            {t("applicationsFindJobs")}
          </Link>
        </section>
      ) : (
        <ul className="space-y-4">
          {applications.map((app) => {
            const date = formatDate(app.date, locale);
            return (
              <li
                key={app.id}
                className="min-w-0 rounded-2xl border border-border bg-card p-5 sm:p-6"
              >
                <article className="space-y-5">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div className="min-w-0 flex-1 space-y-2">
                      {app.companyName ? (
                        <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                          {app.companyName}
                        </p>
                      ) : null}
                      <h2 className="break-words text-xl font-semibold leading-snug text-foreground">
                        {app.jobTitle || t("applicationUnknownJob")}
                      </h2>
                      {date ? (
                        <p className="text-sm text-muted-foreground">
                          {t("applicationSentOn", { date })}
                        </p>
                      ) : null}
                    </div>
                    <StatusPill status={app.status} />
                  </div>
                  <div className="border-t border-border pt-4">
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {t("applicationCurrentStatus")}
                    </p>
                    <div className="mt-3 border-l-4 border-primary py-1 pl-4 text-sm font-medium text-foreground">
                      <StatusPill status={app.status} />
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    {app.slug ? (
                      <Link
                        href={`/oferty-pracy/${app.slug}`}
                        className="inline-flex min-h-12 items-center font-semibold text-primary hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
                      >
                        {t("actionView")}
                      </Link>
                    ) : (
                      <span />
                    )}
                    <ApplicationActions
                      applicationId={app.id}
                      status={app.status}
                      slug={app.slug}
                    />
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
