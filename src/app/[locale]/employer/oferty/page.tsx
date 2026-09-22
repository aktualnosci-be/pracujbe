import type { Metadata } from "next";
import { MapPin, Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { JobLifecycleActions } from "@/components/employer/JobLifecycleActions";
import { getCompanyJobsLoad } from "@/lib/data/employer";

/**
 * Lista ofert firmy (`/employer/oferty`) — cel linku „Zobacz wszystkie oferty" i pozycji nawigacji
 * `navOffers` (P1-13: wcześniej 404, istniała tylko podtrasa `oferty/nowa`).
 *
 * Realne dane pod sesją/RLS (getCompanyJobs — recruiter+). Panel = noindex, force-dynamic.
 * Świadomie BEZ nieaktywnych checkboxów/menu akcji z dashboardu (P1-14).
 *
 * P1-04 (cykl życia): szkic ma link „Dokończ szkic" (wznowienie kreatora — koniec osieroconych
 * draftów), a oferta opublikowana/wstrzymana/zamknięta realne akcje statusu (wstrzymaj/wznów/
 * zamknij/otwórz ponownie) egzekwowane w RPC `set_job_status`.
 */
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "dashboard" });
  return { title: t("navOffers"), robots: { index: false, follow: false } };
}

export default async function EmployerOffersPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);
  const td = await getTranslations("dashboard");
  const result = await getCompanyJobsLoad();

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            {td("employerRole")}
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">
            {td("navOffers")}
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            {td("employerOffersIntro")}
          </p>
        </div>
        <Button asChild className="min-h-12 self-start rounded-xl sm:self-auto">
          <Link href="/employer/oferty/nowa">
            <Plus className="size-4" aria-hidden="true" />
            {td("addJob")}
          </Link>
        </Button>
      </header>

      {result.status === "error" ? (
        <section
          role="alert"
          className="rounded-3xl border border-border bg-card p-6 sm:p-8"
        >
          <h2 className="text-xl font-semibold text-foreground">
            {td("employerOffersLoadError")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {td("employerOffersLoadErrorHint")}
          </p>
          <a
            href={`/${locale}/employer/oferty`}
            className="mt-5 inline-flex min-h-12 items-center rounded-xl border border-border px-5 text-sm font-semibold text-foreground hover:bg-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          >
            {td("employerOffersRetry")}
          </a>
        </section>
      ) : result.jobs.length === 0 ? (
        <section className="rounded-3xl border border-border bg-card p-6 sm:p-8">
          <h2 className="text-xl font-semibold text-foreground">
            {td("employerOffersEmptyTitle")}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {td("employerOffersEmptyHint")}
          </p>
          <Button
            asChild
            variant="outline"
            className="mt-5 min-h-12 rounded-xl"
          >
            <Link href="/employer/oferty/nowa">{td("addJob")}</Link>
          </Button>
        </section>
      ) : (
        <ul
          className="grid min-w-0 gap-4 xl:grid-cols-2"
          aria-label={td("navOffers")}
        >
          {result.jobs.map((offer) => (
            <li key={offer.id} className="min-w-0">
              <article className="flex h-full min-w-0 flex-col rounded-3xl border border-border bg-card p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <span className="max-w-full break-all rounded-full bg-soft px-3 py-1 text-xs font-medium text-muted-foreground">
                    {td("offerId")}: {offer.id}
                  </span>
                  <StatusPill status={offer.status} />
                </div>
                <h2 className="mt-5 min-w-0 break-words text-xl font-bold leading-tight tracking-tight text-foreground sm:text-2xl">
                  {offer.title}
                </h2>
                {offer.city ? (
                  <p className="mt-3 flex min-w-0 items-center gap-2 break-words text-sm text-muted-foreground">
                    <MapPin className="size-4 shrink-0" aria-hidden="true" />
                    {offer.city}
                  </p>
                ) : null}
                <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5">
                  <div className="min-w-0">
                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {td("employerOffersApplicationsLabel")}
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">
                      {offer.newApplications}
                    </dd>
                  </div>
                  <div className="min-w-0 border-l border-border pl-4">
                    <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {td("colMatched")}
                    </dt>
                    <dd className="mt-1 text-2xl font-semibold text-foreground">
                      {offer.matched}
                    </dd>
                  </div>
                </dl>
                <div className="mt-auto flex flex-wrap items-center gap-2 pt-5">
                  {offer.status === "draft" ? (
                    <Button
                      asChild
                      variant="outline"
                      className="min-h-12 rounded-xl"
                    >
                      <Link href={`/employer/oferty/${offer.id}/edycja`}>
                        {td("resumeDraft")}
                      </Link>
                    </Button>
                  ) : (
                    <JobLifecycleActions
                      jobId={offer.id}
                      status={offer.status}
                    />
                  )}
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
