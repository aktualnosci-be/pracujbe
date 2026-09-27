"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useErrorRetry } from "@/components/errors/use-error-retry";
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  EYEBROW,
  H1,
  INTRO,
} from "@/components/dashboard/panel-styles";
import { captureError } from "@/lib/error-report";

/**
 * Granica błędu panelu pracodawcy (`src/app/[locale]/employer/error.tsx`).
 *
 * Leży POD layoutem `/employer`, więc nieobsłużony błąd strony panelu zostawia chrome
 * (sidebar, przełącznik firmy, dolny pasek) — wcześniej błąd wędrował do `[locale]/error.tsx`,
 * który zastępował cały panel. Treść trafia do `<main>` DashboardShell, więc bez własnego
 * landmarku. Komunikat wyłącznie z i18n (Invariant #8), do kanału błędów idzie sam kod
 * (`captureError`, #502). Ponowienie = świeże dane serwera (`useErrorRetry`:
 * `router.refresh()` + `reset()`).
 */
export function EmployerPanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("dashboard");
  const tc = useTranslations("common");
  const { retry } = useErrorRetry(reset);

  useEffect(() => {
    captureError(error, { area: "employer.error-boundary", digest: error.digest });
  }, [error]);

  return (
    <section role="alert" aria-labelledby="employer-panel-error-title" className="space-y-4">
      <p className={EYEBROW}>{t("employerRole")}</p>
      <h1 id="employer-panel-error-title" className={H1}>
        {t("employerPanelErrorTitle")}
      </h1>
      <p className={INTRO}>{t("employerPanelErrorBody")}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="button" onClick={retry} className={BTN_PRIMARY}>
          {tc("retry")}
        </button>
        <Link href="/employer" className={BTN_SECONDARY}>
          {t("employerPanelBackToDashboard")}
        </Link>
      </div>
    </section>
  );
}
