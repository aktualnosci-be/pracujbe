import * as React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConversationOpenPending } from "@/components/messaging/ConversationOpenPending";
import pl from "@/messages/pl.json";
import nl from "@/messages/nl.json";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";

const linkStatus = vi.hoisted(() => ({ pending: false }));
vi.mock("next/link", () => ({ useLinkStatus: () => linkStatus }));

afterEach(() => {
  cleanup();
  linkStatus.pending = false;
});

describe("opening a conversation", () => {
  for (const [locale, messages] of [
    ["pl", pl],
    ["nl", nl],
    ["fr", fr],
    ["en", en],
  ] as const) {
    it(`announces the pending thread only while navigation waits in ${locale}`, () => {
      const view = render(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ConversationOpenPending />
        </NextIntlClientProvider>,
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();

      linkStatus.pending = true;
      view.rerender(
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ConversationOpenPending />
        </NextIntlClientProvider>,
      );
      expect(screen.getByRole("status")).toHaveTextContent(
        messages.messages.opening,
      );
    });
  }
});
