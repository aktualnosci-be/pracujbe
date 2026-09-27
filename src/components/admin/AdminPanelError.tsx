"use client";

import { useEffect } from "react";
import { useTranslations } from "next-intl";

import { Link } from "@/i18n/navigation";
import { useErrorRetry } from "@/components/errors/use-error-retry";
import { BTN_PRIMARY, BTN_SECONDARY, EYEBROW, H1, INTRO } from "@/components/dashboard/panel-styles";
import { captureError } from "@/lib/error-report";

/**
 * Granica błędu panelu administratora (`src/app/[locale]/admin/error.tsx`).
 *
 * Leży POD layoutem `/admin`, więc renderuje się wyłącznie po przejściu guardu roli (błąd
 * albo `notFound()` rzucony przez sam layout łapie granica nadrzędna). Nieobsłużony błąd
 * strony zostawia menu panelu. Komunikat z i18n (Invariant #8), do kanału błędów sam kod
 * (`captureError`, #502). Ponowienie = `router.refresh()` + `reset()` (`useErrorRetry`).
 */
export function AdminPanelError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("admin");
  const tc = useTranslations("common");
  const { retry } = useErrorRetry(reset);

  useEffect(() => {
    captureError(error, { area: "admin.error-boundary", digest: error.digest });
  }, [error]);

  return (
    <section role="alert" aria-labelledby="admin-panel-error-title" className="space-y-4">
      <p className={EYEBROW}>{t("brandTag")}</p>
      <h1 id="admin-panel-error-title" className={H1}>
        {t("panelErrorTitle")}
      </h1>
      <p className={INTRO}>{t("panelErrorBody")}</p>
      <div className="flex flex-wrap items-center gap-3 pt-2">
        <button type="button" onClick={retry} className={BTN_PRIMARY}>
          {tc("retry")}
        </button>
        <Link href="/admin" className={BTN_SECONDARY}>
          {t("panelBackToSummary")}
        </Link>
      </div>
    </section>
  );
}
