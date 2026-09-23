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
        "inline-flex items-center rounded-full px-3 py-1 text-sm font-medium",
        known ? STATUS_TONE[status] : "bg-muted text-muted-foreground",
        className,
      )}
    >
      {known ? t(status) : t("unknown")}
    </span>
  );
}
