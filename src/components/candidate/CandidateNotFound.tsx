import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, H1, INTRO } from "@/components/dashboard/panel-styles";

/**
 * Strona 404 wewnątrz panelu kandydata (`src/app/[locale]/candidate/not-found.tsx`).
 *
 * `notFound()` ze szczegółu zgłoszenia (cudze/usunięte/nieistniejące) albo z importu CV bez
 * flagi trafiał do `[locale]/not-found.tsx`, który leży NAD layoutem `/candidate`: kandydat
 * tracił menu panelu i widział publiczny nagłówek. Komunikat nie mówi, czy obiekt istnieje
 * (cudze zgłoszenie = to samo co nieistniejące). Status odpowiedzi zostaje 404; noindex
 * dziedziczy się z layoutu panelu (Invariant #9). Linki: pulpit, zgłoszenia, polecane oferty.
 */
export async function CandidateNotFound() {
  const locale = await getLocale();
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: "dashboard" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return (
    <section aria-labelledby="candidate-not-found-title" className="space-y-4">
      {/* Metadane not-found nie nadpisują tytułu layoutu — jak w `[locale]/not-found.tsx`. */}
      <title>{`${t("candidateNotFoundTitle")} · ${tc("appName")}`}</title>
      {/* Kod „404” jest liczbą — bez tłumaczenia. */}
      <p className={EYEBROW}>404</p>
      <h1 id="candidate-not-found-title" className={H1}>
        {t("candidateNotFoundTitle")}
      </h1>
      <p className={INTRO}>{t("candidateNotFoundBody")}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link href="/candidate" className={BTN_PRIMARY}>
          {t("candidatePanelBackToDashboard")}
        </Link>
        <Link href="/candidate/aplikacje" className={BTN_SECONDARY}>
          {t("navApplications")}
        </Link>
        {/* #1139: bez linku do polecanych ofert (404 w trybie ogłoszeniowym). */}
        <Link href="/candidate/wyszukiwania" className={BTN_SECONDARY}>
          {t("navSearches")}
        </Link>
      </div>
    </section>
  );
}
