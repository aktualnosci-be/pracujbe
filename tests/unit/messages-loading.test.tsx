import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it } from "vitest";

import { MessagesLoading } from "@/components/messaging/MessagesLoading";
import pl from "@/messages/pl.json";
import nl from "@/messages/nl.json";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";

afterEach(cleanup);

describe("messaging loading shell", () => {
  for (const [locale, messages] of [
    ["pl", pl],
    ["nl", nl],
    ["fr", fr],
    ["en", en],
  ] as const) {
    it(`announces the pending read in ${locale} without example conversations`, () => {
      const { container } = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <MessagesLoading />
        </NextIntlClientProvider>,
      );

      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        messages.messages.title,
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        messages.messages.loading,
      );
      expect(container.firstElementChild).toHaveAttribute("aria-busy", "true");
      expect(screen.queryByRole("list")).not.toBeInTheDocument();
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
    });
  }
});
