import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { isRecruitmentEnabled } from "@/lib/portal-mode";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  H1,
  INTRO,
} from "@/components/dashboard/panel-styles";

/**
 * Strona 404 wewnątrz panelu pracodawcy (`src/app/[locale]/employer/not-found.tsx`).
 *
 * `notFound()` ze szczegółu zgłoszenia (cudze/nieistniejące — #300) albo z edycji oferty trafiał
 * do `[locale]/not-found.tsx`, który leży NAD layoutem `/employer`: rekruter tracił sidebar
 * i przełącznik firmy, a widział publiczny nagłówek i linki „Oferty pracy”/„Strona główna”.
 * Częsta przyczyna w panelu to obiekt z INNEJ firmy niż aktywna (multi-company, FUN-07), więc
 * komunikat podpowiada przełącznik firmy — bez ujawniania, czy obiekt istnieje. Status
 * odpowiedzi zostaje 404; noindex dziedziczy się z layoutu panelu (Invariant #9).
 */
export async function EmployerNotFound() {
  const locale = await getLocale();
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: "dashboard" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return (
    <section aria-labelledby="employer-not-found-title" className="space-y-4">
      {/* Metadane not-found nie nadpisują tytułu layoutu — jak w `[locale]/not-found.tsx`. */}
      <title>{`${t("employerNotFoundTitle")} · ${tc("appName")}`}</title>
      {/* Kod „404” jest liczbą — bez tłumaczenia. */}
      <p className={EYEBROW}>404</p>
      <h1 id="employer-not-found-title" className={H1}>
        {t("employerNotFoundTitle")}
      </h1>
      <p className={INTRO}>{t("employerNotFoundBody")}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link href="/employer" className={BTN_PRIMARY}>
          {t("employerPanelBackToDashboard")}
        </Link>
        {/* #1144: panel zgłoszeń tylko w trybie RECRUITMENT (portal ogłoszeniowy). */}
        {isRecruitmentEnabled() ? (
          <Link href="/employer/aplikacje" className={BTN_SECONDARY}>
            {t("navEmployerApplications")}
          </Link>
        ) : null}
        <Link href="/employer/oferty" className={BTN_SECONDARY}>
          {t("navOffers")}
        </Link>
      </div>
    </section>
  );
}
