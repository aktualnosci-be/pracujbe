import { getLocale, getTranslations } from "next-intl/server";

import { Link } from "@/i18n/navigation";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, H1, INTRO } from "@/components/dashboard/panel-styles";

/**
 * Strona 404 wewnątrz panelu administratora (`src/app/[locale]/admin/not-found.tsx`).
 *
 * Granica leży POD layoutem `/admin`. `notFound()` z guardu roli w `admin/layout.tsx` rzuca
 * sam layout, więc łapie go granica NADRZĘDNA (`[locale]/not-found.tsx`) — nie-admin nadal
 * widzi ogólną 404, bez śladu panelu. Ten komponent widzi tylko sesja, która przeszła guard
 * (`notFound()` ze strony albo warstwy danych panelu, np. brak kampanii). Nieznany adres pod
 * `/admin/…` obsługuje catch-all `[locale]/[...rest]` — ogólna 404, jak dotąd. Komunikat nie
 * mówi, czy obiekt istnieje; status 404, noindex z layoutu (Invariant #9).
 */
export async function AdminNotFound() {
  const locale = await getLocale();
  const [t, tc] = await Promise.all([
    getTranslations({ locale, namespace: "admin" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return (
    <section aria-labelledby="admin-not-found-title" className="space-y-4">
      {/* Metadane not-found nie nadpisują tytułu layoutu — jak w `[locale]/not-found.tsx`. */}
      <title>{`${t("panelNotFoundTitle")} · ${tc("appName")}`}</title>
      {/* Kod „404” jest liczbą — bez tłumaczenia. */}
      <p className={EYEBROW}>404</p>
      <h1 id="admin-not-found-title" className={H1}>
        {t("panelNotFoundTitle")}
      </h1>
      <p className={INTRO}>{t("panelNotFoundBody")}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <Link href="/admin" className={BTN_PRIMARY}>
          {t("panelBackToSummary")}
        </Link>
        <Link href="/admin/firmy" className={BTN_SECONDARY}>
          {t("navCompanies")}
        </Link>
        <Link href="/admin/zgloszenia" className={BTN_SECONDARY}>
          {t("navReports")}
        </Link>
      </div>
    </section>
  );
}
