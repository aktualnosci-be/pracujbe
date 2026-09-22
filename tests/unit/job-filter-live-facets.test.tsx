import * as React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FilterSidebar } from "@/components/public/FilterSidebar";
import {
  emptySidebarFilters,
  type SidebarFilters,
} from "@/components/public/job-filters";
import en from "@/messages/en.json";
import type { JobFilterFacets } from "@/types/job-filter-facets";

const push = vi.fn();

vi.mock("@/i18n/navigation", () => ({
  usePathname: () => "/jobs",
  useRouter: () => ({ push }),
}));

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function facets(total: number): JobFilterFacets {
  return {
    total,
    categories: { warehouse: total },
    locations: [{ city: "Antwerp", count: total }],
    contracts: { permanent: total },
    accommodation: { provided: total, unavailable: 0 },
    immediate: total,
    noLanguage: total,
  };
}

function response(value: JobFilterFacets): Response {
  return {
    ok: true,
    json: async () => value,
  } as Response;
}

function show(initial: SidebarFilters = emptySidebarFilters()) {
  return render(
    <NextIntlClientProvider locale="en" messages={en}>
      <FilterSidebar facets={facets(12)} initial={initial} sort="newest" />
    </NextIntlClientProvider>,
  );
}

async function startRequest(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(150);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal("fetch", vi.fn());
  push.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("dokładny licznik oczekujących filtrów", () => {
  it("natychmiast usuwa starą liczbę, blokuje CTA i pokazuje dokładny wynik przed apply", async () => {
    const request = deferred<Response>();
    vi.mocked(fetch).mockReturnValueOnce(request.promise);
    show();

    expect(screen.getByRole("button", { name: "Show 12 jobs" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Immediate start"));

    const pendingCta = screen.getByRole("button", { name: "Counting jobs…" });
    expect(pendingCta).toBeDisabled();
    expect(pendingCta).toHaveAttribute("aria-busy", "true");
    expect(
      screen.queryByRole("button", { name: "Show 12 jobs" }),
    ).not.toBeInTheDocument();

    await startRequest();
    await act(async () => request.resolve(response(facets(3))));

    const exactCta = screen.getByRole("button", { name: "Show 3 jobs" });
    expect(exactCta).toBeEnabled();
    expect(push).not.toHaveBeenCalled();
    fireEvent.click(exactCta);
    expect(push).toHaveBeenCalledWith("/jobs?immediate=1");
  });

  it("zachowuje wynik nowszego żądania, gdy starsze kończy się później", async () => {
    const older = deferred<Response>();
    const newer = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(older.promise)
      .mockReturnValueOnce(newer.promise);
    show();

    fireEvent.click(screen.getByLabelText("Immediate start"));
    await startRequest();
    fireEvent.click(screen.getByLabelText("No language required"));
    await startRequest();

    await act(async () => newer.resolve(response(facets(2))));
    expect(screen.getByRole("button", { name: "Show 2 jobs" })).toBeEnabled();

    await act(async () => older.resolve(response(facets(9))));
    expect(screen.getByRole("button", { name: "Show 2 jobs" })).toBeEnabled();
    expect(
      screen.queryByRole("button", { name: "Show 9 jobs" }),
    ).not.toBeInTheDocument();
  });

  it("pokazuje lokalizowany błąd bez liczby, pozwala ponowić i zachowuje wybraną lokalizację z zerem", async () => {
    const failed = deferred<Response>();
    const retried = deferred<Response>();
    vi.mocked(fetch)
      .mockReturnValueOnce(failed.promise)
      .mockReturnValueOnce(retried.promise);
    const initial = emptySidebarFilters();
    initial.locations = ["Liège"];
    show(initial);

    expect(screen.getByLabelText("Liège")).toBeChecked();
    expect(
      document.querySelector('[data-filter-count="d-loc-Liège"]'),
    ).toHaveTextContent("0");

    fireEvent.click(screen.getByLabelText("Immediate start"));
    await startRequest();
    await act(async () => failed.reject(new Error("transport")));

    expect(screen.getByRole("alert")).toHaveTextContent(
      "We could not count the jobs. Try again.",
    );
    expect(
      screen.getByRole("button", { name: "Job count unavailable" }),
    ).toBeDisabled();
    expect(screen.queryByText("Show 12 jobs")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Count again" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await startRequest();
    await act(async () => retried.resolve(response(facets(0))));

    expect(screen.getByRole("button", { name: "Show 0 jobs" })).toBeEnabled();
    expect(screen.getByLabelText("Liège")).toBeChecked();
  });
});
