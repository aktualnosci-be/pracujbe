"use client";

import { useLinkStatus } from "next/link";
import { useTranslations } from "next-intl";

/** Informacja przy klikniętej rozmowie, gdy zmiana samego `?c=` czeka na dane RSC. */
export function ConversationOpenPending() {
  const { pending } = useLinkStatus();
  const t = useTranslations("messages");

  return pending ? (
    <span
      role="status"
      className="mt-1 block text-xs font-semibold text-primary"
    >
      {t("opening")}
    </span>
  ) : null;
}
