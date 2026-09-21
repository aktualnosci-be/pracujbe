import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SaveJobButton } from "@/components/candidate/SaveJobButton";

const { toggleSavedJob } = vi.hoisted(() => ({ toggleSavedJob: vi.fn() }));
vi.mock("@/lib/actions/candidate", () => ({ toggleSavedJob }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("Zapis oferty przy błędzie transportu", () => {
  it.each([false, true])(
    "odtwarza stan %s po odrzuceniu żądania i pozwala ponowić",
    async (initialSaved) => {
      toggleSavedJob.mockRejectedValueOnce(new Error("network failure"));
      render(<SaveJobButton jobId="job-1" initialSaved={initialSaved} />);
      const button = screen.getByRole("button", {
        name: initialSaved ? "saved" : "save",
      });
      fireEvent.click(button);
      await waitFor(() =>
        expect(screen.getByRole("status")).toHaveTextContent("generic"),
      );
      expect(button).toHaveAttribute("aria-pressed", String(initialSaved));
      await waitFor(() => expect(button).toBeEnabled());
      expect(screen.queryByText("network failure")).not.toBeInTheDocument();
      toggleSavedJob.mockResolvedValueOnce({ ok: true, saved: !initialSaved });
      fireEvent.click(button);
      await waitFor(() =>
        expect(button).toHaveAttribute("aria-pressed", String(!initialSaved)),
      );
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    },
  );
});
