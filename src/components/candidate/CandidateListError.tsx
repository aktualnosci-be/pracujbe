"use client";

import { useTranslations } from "next-intl";

export function CandidateListError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("dashboard");
  return (
    <section
      role="alert"
      className="rounded-2xl border border-border bg-card p-6 sm:p-8"
    >
      <h1 className="text-xl font-semibold text-foreground">
        {t("candidateListErrorTitle")}
      </h1>
      <p className="mt-2 text-base text-muted-foreground">
        {t("candidateListErrorBody")}
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-5 min-h-12 rounded-xl bg-primary px-5 font-semibold text-primary-foreground hover:bg-primary/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        {t("candidateListRetry")}
      </button>
    </section>
  );
}
