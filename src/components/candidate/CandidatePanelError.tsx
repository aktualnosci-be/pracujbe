"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useErrorRetry } from "@/components/errors/use-error-retry";
import { BTN_PRIMARY, BTN_SECONDARY, H1, INTRO } from "@/components/dashboard/panel-styles";
import { captureError } from "@/lib/error-report";

/**
 * Granica błędu panelu kandydata (`src/app/[locale]/candidate/error.tsx`).
 *
 * Leży POD layoutem `/candidate`, więc nieobsłużony błąd strony panelu zostawia chrome
 * (sidebar, topbar, dolny pasek) — wcześniej błąd wędrował do `[locale]/error.tsx`, który
 * zastępował cały panel. Treść trafia do `<main>` DashboardShell, więc bez własnego landmarku.
 * Komunikat wyłącznie z i18n (Invariant #8), do kanału błędów idzie sam kod (`captureError`,
 * #502 — treść wyjątku nie trafia do UI). Ponowienie = świeże dane serwera
 * (`useErrorRetry`: `router.refresh()` + `reset()`).
 */
export function CandidatePanelError({
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
    captureError(error, { area: "candidate.error-boundary", digest: error.digest });
  }, [error]);

  return (
    <section role="alert" aria-labelledby="candidate-panel-error-title" className="space-y-4">
      <h1 id="candidate-panel-error-title" className={H1}>
        {t("candidatePanelErrorTitle")}
      </h1>
      <p className={INTRO}>{t("candidatePanelErrorBody")}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="button" onClick={retry} className={BTN_PRIMARY}>
          {tc("retry")}
        </button>
        <Link href="/candidate" className={BTN_SECONDARY}>
          {t("candidatePanelBackToDashboard")}
        </Link>
      </div>
    </section>
  );
}
