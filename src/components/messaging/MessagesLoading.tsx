"use client";

import { useTranslations } from "next-intl";
import { EYEBROW, H1_EXTENDED, P_EXTENDED } from "@/components/dashboard/panel-styles";

/** Fallback podczas odczytu rozmów; nie pokazuje przykładowych danych użytkowników. */
/** `panel` wybiera `.eyebrow` ekranu jak w `MessagesView`; bez niego nagłówek bez etykiety. */
export function MessagesLoading({ panel }: { panel?: "candidate" | "employer" } = {}) {
  const t = useTranslations("messages");
  const td = useTranslations("dashboard");
  const eyebrow =
    panel === "candidate"
      ? td("candidatePlaceEyebrow")
      : panel === "employer"
        ? td("employerPlaceEyebrow")
        : null;

  return (
    <div className="min-w-0" aria-busy="true">
      <div className="mb-[25px] min-w-0">
        {eyebrow ? <p className={EYEBROW}>{eyebrow}</p> : null}
        <h1 className={H1_EXTENDED}>{t("title")}</h1>
        <p className={P_EXTENDED}>{t("subtitle")}</p>
      </div>

      <div className="grid min-h-[28rem] grid-cols-1 overflow-hidden rounded-[22px] border border-border bg-card max-[600px]:rounded-[18px] lg:h-[calc(100vh-14rem)] lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
        <div className="border-border p-5 lg:border-r">
          <p role="status" className="text-base font-medium text-foreground">
            {t("loading")}
          </p>
          <div
            aria-hidden="true"
            className="mt-6 space-y-5 motion-safe:animate-pulse"
          >
            <div className="h-16 rounded-xl bg-soft" />
            <div className="h-16 rounded-xl bg-soft" />
            <div className="h-16 rounded-xl bg-soft" />
          </div>
        </div>
        <div aria-hidden="true" className="hidden p-6 lg:block">
          <div className="h-5 w-1/2 rounded-lg bg-soft motion-safe:animate-pulse" />
        </div>
      </div>
    </div>
  );
}
