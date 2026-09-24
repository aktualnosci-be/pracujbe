"use client";

import { useTranslations } from "next-intl";

import { useErrorRetry } from "@/components/errors/use-error-retry";
import { BTN_PRIMARY, H2_EXTENDED, P_EXTENDED, PAPER } from "@/components/dashboard/panel-styles";
import { cn } from "@/lib/utils";

export function CandidateListError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("dashboard");
  const { retry } = useErrorRetry(reset);
  return (
    <section
      role="alert"
      className={PAPER}
    >
      <h1 className={H2_EXTENDED}>
        {t("candidateListErrorTitle")}
      </h1>
      <p className={cn(P_EXTENDED, "mt-2")}>
        {t("candidateListErrorBody")}
      </p>
      <button
        type="button"
        onClick={retry}
        className={cn(BTN_PRIMARY, "mt-5")}
      >
        {t("candidateListRetry")}
      </button>
    </section>
  );
}
