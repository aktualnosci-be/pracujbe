import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard } from "@/components/employer/JobWizard";

const { createJobDraft, updateJobDraft, publishJob, push } = vi.hoisted(() => ({
  createJobDraft: vi.fn(),
  updateJobDraft: vi.fn(),
  publishJob: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/actions/jobs", () => ({
  createJobDraft,
  updateJobDraft,
  publishJob,
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "pl",
}));

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  createJobDraft.mockResolvedValue({ ok: true, id: "draft-1", demo: true });
  updateJobDraft.mockResolvedValue({ ok: true, demo: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("JobWizard: komunikaty błędów i fokus", () => {
  it("wiąże błąd tytułu z polem i kieruje fokus na pierwszy błąd", async () => {
    render(<JobWizard />);
    const title = screen.getByLabelText("titleLabel");
    const category = screen.getByRole("combobox", { name: "categoryLabel" });
    expect(title).not.toHaveAttribute("aria-describedby");
    expect(category).not.toHaveAttribute("aria-describedby");

    fireEvent.click(screen.getByRole("button", { name: "next" }));

    await waitFor(() => expect(title).toHaveFocus());
    expect(title).toHaveAttribute("aria-invalid", "true");
    expect(title).toHaveAttribute("aria-describedby", "job-title-error");
    expect(document.getElementById("job-title-error")).toHaveTextContent(
      "titleTooShort",
    );
    expect(category).toHaveAttribute("aria-describedby", "job-category-error");
    expect(document.getElementById("job-category-error")).toHaveTextContent(
      "categoryRequired",
    );
    expect(createJobDraft).not.toHaveBeenCalled();
  });

  it("gdy tytuł jest poprawny, fokusuje kategorię i opisuje błąd listy wyboru", async () => {
    render(<JobWizard />);
    fireEvent.change(screen.getByLabelText("titleLabel"), {
      target: { value: "Operator magazynu" },
    });
    fireEvent.change(screen.getByLabelText("occupationLabel"), {
      target: { value: "Magazynier" },
    });
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    const category = screen.getByRole("combobox", { name: "categoryLabel" });
    await waitFor(() => expect(category).toHaveFocus());
    expect(category).toHaveAttribute("aria-invalid", "true");
    expect(category).toHaveAttribute("aria-describedby", "job-category-error");
    expect(document.getElementById("job-category-error")).toHaveTextContent(
      "categoryRequired",
    );
    expect(screen.getByLabelText("titleLabel")).not.toHaveAttribute(
      "aria-describedby",
    );
  });
});
