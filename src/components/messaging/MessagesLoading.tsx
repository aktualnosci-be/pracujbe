"use client";

import { useTranslations } from "next-intl";

/** Fallback podczas odczytu rozmów; nie pokazuje przykładowych danych użytkowników. */
export function MessagesLoading() {
  const t = useTranslations("messages");

  return (
    <div className="space-y-5" aria-busy="true">
      <div>
        <h1 className="text-3xl font-bold tracking-tight text-foreground">
          {t("title")}
        </h1>
        <p className="mt-1 text-base text-muted-foreground">{t("subtitle")}</p>
      </div>

      <div className="grid min-h-[28rem] grid-cols-1 overflow-hidden rounded-2xl border border-border bg-card shadow-sm lg:h-[calc(100vh-14rem)] lg:grid-cols-[minmax(16rem,20rem)_minmax(0,1fr)]">
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
