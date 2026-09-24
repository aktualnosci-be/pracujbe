import { useTranslations } from "next-intl";

import { cn } from "@/lib/utils";

const STATUS_TONE = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-primary/10 text-primary-dark",
  viewed: "bg-warning/10 text-warning-text",
  accepted: "bg-success/10 text-success-text",
  declined: "bg-error/10 text-error-text",
  expired: "bg-muted text-muted-foreground",
  cancelled: "bg-muted text-muted-foreground",
} as const;

type ProposalStatus = keyof typeof STATUS_TONE;

function isProposalStatus(status: string): status is ProposalStatus {
  return Object.hasOwn(STATUS_TONE, status);
}

export function ProposalStatusPill({
  status,
  className,
}: {
  status: string;
  className?: string;
}) {
  const t = useTranslations("offerStatus");
  const known = isProposalStatus(status);

  return (
    <span
      className={cn(
        /* `.status` z prototypu: promień 8 px, padding 8/12 px, 12 px. */
        "inline-block max-w-full break-words rounded-[8px] px-3 py-2 text-xs font-medium",
        known ? STATUS_TONE[status] : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {known ? t(status) : t("unknown")}
    </span>
  );
}
