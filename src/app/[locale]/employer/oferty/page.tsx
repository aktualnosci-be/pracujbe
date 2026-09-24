import type { Metadata } from "next";
import { ExternalLink, ImageIcon, MapPin, Pencil, Plus } from "lucide-react";
import { getTranslations, setRequestLocale } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { StatusPill } from "@/components/ui/status-pill";
import { JobLifecycleActions } from "@/components/employer/JobLifecycleActions";
import { RecruiterOnlyNote } from "@/components/employer/RecruiterOnlyNote";
import { getCompanyJobsLoad, getEmployerShellData } from "@/lib/data/employer";
import { canRecruit } from "@/lib/team/permissions";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  H1_EXTENDED,
  INFO_LABEL,
  INTRO,
  JOB_CARD,
  JOB_CARD_TITLE,
  PANEL,
  PANEL_H2,
  PANEL_P,
  TAG,
  TEXT_LINK,
} from '@/components/dashboard/panel-styles';

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
 *
 * #325: aktywną i wstrzymaną ofertę można poprawić („Edytuj" → kreator w trybie edycji,
 * RPC `update_published_job`), a aktywną obejrzeć publicznie („Zobacz ofertę").
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

/** Data utworzenia oferty w języku interfejsu — zamiast surowego UUID (Invariant #8, #330). */
function formatCreatedAt(iso: string, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeZone: "Europe/Brussels",
  }).format(date);
}

export default async function EmployerOffersPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ page?: string }>;
}) {
  const { locale } = await params;
  const { page: requestedPage } = await searchParams;
  const parsedPage =
    requestedPage && /^[1-9]\d*$/.test(requestedPage)
      ? Number(requestedPage)
      : 1;
  const page =
    Number.isSafeInteger(parsedPage) &&
    parsedPage <= Math.floor(Number.MAX_SAFE_INTEGER / 12)
      ? parsedPage
      : 1;
  setRequestLocale(locale);
  const td = await getTranslations("dashboard");
  const tb = await getTranslations("campaignBanner");
  const [result, shell] = await Promise.all([
    getCompanyJobsLoad(page),
    getEmployerShellData(),
  ]);
  // #403: rola member przegląda oferty; tworzenie/edycja/cykl życia wymagają recruiter+.
  const canRecruitHere = shell.status !== "ok" || canRecruit(shell.activeRole);
  const pageHref = (target: number) =>
    target === 1 ? "/employer/oferty" : `/employer/oferty?page=${target}`;

  return (
    <div className="space-y-7">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <p className={EYEBROW}>
            {td("employerRole")}
          </p>
          <h1 className={H1_EXTENDED}>
            {td("navOffers")}
          </h1>
          <p className={INTRO}>
            {td("employerOffersIntro")}
          </p>
        </div>
        {canRecruitHere ? (
          <Link className={BTN_PRIMARY} href="/employer/oferty/nowa">
              <Plus className="size-4" aria-hidden="true" />
              {td("addJob")}
            </Link>
        ) : (
          <RecruiterOnlyNote locale={locale} />
        )}
      </header>

      {result.status === "error" ? (
        <section
          role="alert"
          className={PANEL}
        >
          <h2 className={PANEL_H2}>
            {td("employerOffersLoadError")}
          </h2>
          <p className={`mt-2 ${PANEL_P}`}>
            {td("employerOffersLoadErrorHint")}
          </p>
          <a
            href={`/${locale}${pageHref(page)}`}
            className={`mt-5 ${BTN_SECONDARY}`}
          >
            {td("employerOffersRetry")}
          </a>
        </section>
      ) : result.jobs.length === 0 && page > 1 ? (
        <section className={PANEL}>
          <h2 className={PANEL_H2}>
            {td("employerOffersPageEmpty")}
          </h2>
          <Link
            href={pageHref(1)}
            className={`mt-5 ${BTN_SECONDARY}`}
          >
            {td("employerOffersFirstPage")}
          </Link>
        </section>
      ) : result.jobs.length === 0 ? (
        <section className={PANEL}>
          <h2 className={PANEL_H2}>
            {td("employerOffersEmptyTitle")}
          </h2>
          <p className={`mt-2 ${PANEL_P}`}>
            {td("employerOffersEmptyHint")}
          </p>
          {canRecruitHere ? (
            <Link className={`mt-5 ${BTN_SECONDARY}`} href="/employer/oferty/nowa">{td("addJob")}</Link>
          ) : null}
        </section>
      ) : (
        <>
          <ul
            className="grid min-w-0 gap-5 xl:grid-cols-2"
            aria-label={td("navOffers")}
          >
            {result.jobs.map((offer) => (
              <li key={offer.id} className="min-w-0">
                <article className={JOB_CARD}>
                  <div
                    className="flex flex-wrap items-start justify-between gap-3"
                    data-job-id={offer.id}
                  >
                    {offer.createdAt && formatCreatedAt(offer.createdAt, locale) ? (
                      <span className={TAG}>
                        {td("employerOffersCreatedLabel", {
                          date: formatCreatedAt(offer.createdAt, locale),
                        })}
                      </span>
                    ) : null}
                    <StatusPill status={offer.status} className="ml-auto" />
                  </div>
                  <h2 className={`mt-[10px] ${JOB_CARD_TITLE}`}>
                    {offer.title}
                  </h2>
                  {offer.city ? (
                    <p className="mt-3 flex min-w-0 items-center gap-2 break-words text-[13px] leading-[1.4] text-muted-foreground">
                      <MapPin className="size-4 shrink-0" aria-hidden="true" />
                      {offer.city}
                    </p>
                  ) : null}
                  <dl className="mt-6 grid grid-cols-2 gap-4 border-y border-border py-5">
                    <div className="min-w-0">
                      <dt className={INFO_LABEL}>
                        {td("employerOffersApplicationsLabel")}
                      </dt>
                      <dd className="mt-1 block text-[22px] font-[650] tracking-[-0.035em] tabular-nums text-foreground">
                        {offer.newApplications}
                      </dd>
                    </div>
                    <div className="min-w-0 border-l border-border pl-4">
                      <dt className={INFO_LABEL}>
                        {td("colMatched")}
                      </dt>
                      <dd className="mt-1 block text-[22px] font-[650] tracking-[-0.035em] tabular-nums text-foreground">
                        {offer.matched}
                      </dd>
                    </div>
                  </dl>
                  <div className="mt-auto flex flex-wrap items-center gap-[9px] pt-[14px]">
                    {offer.status === "draft" ? (
                      !canRecruitHere ? null : (
                      <Link className={BTN_SECONDARY} href={`/employer/oferty/${offer.id}/edycja`}>
                          {td("resumeDraft")}
                        </Link>
                      )
                    ) : (
                      <>
                        {/* #325: poprawka opublikowanej oferty bez zmiany statusu i zgłoszeń. */}
                        {canRecruitHere &&
                        (offer.status === "active" || offer.status === "paused") ? (
                          <Link className={BTN_SECONDARY}
                              href={`/employer/oferty/${offer.id}/edycja`}
                              aria-label={td("editJobLabel", { title: offer.title })}
                            >
                              <Pencil className="size-4" aria-hidden="true" />
                              {td("editJob")}
                            </Link>
                        ) : null}
                        {offer.status === "active" &&
                        offer.slug &&
                        !offer.slug.startsWith("draft-") ? (
                          <Link
                            href={`/oferty-pracy/${offer.slug}`}
                            aria-label={td("viewJobLabel", { title: offer.title })}
                            className={TEXT_LINK}
                          >
                            <ExternalLink className="size-4" aria-hidden="true" />
                            {td("viewJob")}
                          </Link>
                        ) : null}
                        {/* #175: baner kampanii tylko dla aktywnej oferty (dostęp i filtry egzekwuje baza). */}
                        {canRecruitHere &&
                        offer.status === "active" &&
                        !offer.pastExpiry &&
                        offer.slug &&
                        !offer.slug.startsWith("draft-") ? (
                          <Link
                            href={`/employer/oferty/${offer.id}/baner`}
                            aria-label={tb("openBannerLabel", { title: offer.title })}
                            className={TEXT_LINK}
                          >
                            <ImageIcon className="size-4" aria-hidden="true" />
                            {tb("openBanner")}
                          </Link>
                        ) : null}
                        {canRecruitHere ? (
                          <JobLifecycleActions
                            jobId={offer.id}
                            status={offer.status}
                            pastExpiry={offer.pastExpiry}
                          />
                        ) : null}
                      </>
                    )}
                  </div>
                </article>
              </li>
            ))}
          </ul>
          {(page > 1 || result.hasNext) && (
            <nav
              aria-label={td("employerOffersPaginationLabel")}
              className="flex flex-wrap items-center justify-center gap-3"
            >
              {page > 1 && (
                <Link
                  href={pageHref(page - 1)}
                  rel="prev"
                  className={BTN_SECONDARY}
                >
                  {td("employerOffersPrevious")}
                </Link>
              )}
              <span
                aria-current="page"
                className="px-2 text-sm text-muted-foreground"
              >
                {td("employerOffersPage", { page })}
              </span>
              {result.hasNext && (
                <Link
                  href={pageHref(page + 1)}
                  rel="next"
                  className={BTN_SECONDARY}
                >
                  {td("employerOffersNext")}
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
