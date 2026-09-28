import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #829 — pola kreatora zostają edytowalne w trakcie zapisu, a akcja dostaje snapshot
 * z chwili kliknięcia. Edycja wprowadzona, zanim serwer odpowie, nie może przepaść:
 * „Zapisz i wyjdź” i „Dalej” zapisują nowszą wartość przed wyjściem/zmianą kroku, a tryb
 * edycji opublikowanej oferty nie pokazuje „Zapisano”, gdy zapisał starszą wersję.
 */

const { createJobDraft, updateJobDraft, publishJob, updatePublishedJob, push } = vi.hoisted(() => ({
  createJobDraft: vi.fn(),
  updateJobDraft: vi.fn(),
  publishJob: vi.fn(),
  updatePublishedJob: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/actions/jobs", () => ({ createJobDraft, updateJobDraft, publishJob, updatePublishedJob }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "pl",
}));

const JOB = "11111111-1111-4111-8111-111111111111";

const DRAFT: JobWizardInitialValues = {
  title: "Magazynier",
  category: "warehouse",
  occupation: "Magazynier",
  contractType: "permanent",
  workingHours: "38 h / tydzień",
  city: "Antwerpia",
  region: "Flandria",
  description: "Obsługa wózka widłowego w magazynie centralnym, załadunek i rozładunek.",
  responsibilities: ["Załadunek towaru"],
  requirementsMandatory: ["Uprawnienia UDT"],
  companyDescription: "Rodzinna firma logistyczna z Antwerpii.",
  contactEmail: "hr@example.be",
  applyEmail: "praca@example.be",
};

type SaveResult = { ok: true; demo: false } | { ok: false; error: string };

/** Pierwszy zapis czeka na ręczne rozwiązanie; kolejne kończą się od razu sukcesem. */
function deferFirstSave(): (value?: SaveResult) => void {
  let resolveSave: (value: SaveResult) => void = () => {};
  updateJobDraft.mockImplementationOnce(
    () =>
      new Promise<SaveResult>((resolve) => {
        resolveSave = resolve;
      }),
  );
  return (value = { ok: true, demo: false }) => resolveSave(value);
}

function titleInput(): HTMLElement {
  return screen.getByLabelText("titleLabel");
}

function savedTitles(): unknown[] {
  return updateJobDraft.mock.calls
    .filter((call) => call[1] === 1)
    .map((call) => (call[2] as { title: string }).title);
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  updateJobDraft.mockResolvedValue({ ok: true, demo: false });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("JobWizard: edycja w trakcie zapisu (#829)", () => {
  it("„Zapisz i wyjdź”: tytuł zmieniony przed odpowiedzią serwera jest zapisany przed wyjściem", async () => {
    const resolveSave = deferFirstSave();
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} />);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));
    expect(updateJobDraft).toHaveBeenCalledTimes(1);
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    resolveSave();

    await waitFor(() => expect(push).toHaveBeenCalledWith("/employer"));
    expect(savedTitles()).toEqual(["Magazynier", "Operator magazynu"]);
    // Ostatni zapis przed nawigacją niesie nowszą wartość.
    const lastSave = updateJobDraft.mock.invocationCallOrder.at(-1) ?? 0;
    expect(lastSave).toBeLessThan(push.mock.invocationCallOrder[0] ?? 0);
  });

  it("„Dalej”: nowsza wartość zapisana, zanim kreator pokaże kolejny krok", async () => {
    const resolveSave = deferFirstSave();
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} />);

    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    resolveSave();

    await screen.findByText("step2Title", { selector: "h2" });
    expect(savedTitles()).toEqual(["Magazynier", "Operator magazynu"]);
  });

  it("bez zmian w trakcie zapisu — jeden zapis (brak zbędnego ponowienia)", async () => {
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} />);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/employer"));
    expect(updateJobDraft).toHaveBeenCalledTimes(1);
  });

  it("kontrola ujemna: niepoprawna nowsza wartość — bez wyjścia, błąd przy polu, bez zapisu jej", async () => {
    const resolveSave = deferFirstSave();
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} />);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));
    fireEvent.change(titleInput(), { target: { value: "" } });
    resolveSave();

    await waitFor(() => expect(titleInput()).toHaveAttribute("aria-invalid", "true"));
    expect(push).not.toHaveBeenCalled();
    expect(savedTitles()).toEqual(["Magazynier"]);
    expect(titleInput()).toHaveValue("");
  });

  it("błąd ponownego zapisu nowszej wartości: komunikat i bez wyjścia", async () => {
    const resolveSave = deferFirstSave();
    updateJobDraft.mockResolvedValueOnce({ ok: false, error: "INTERNAL" });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} />);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    resolveSave();

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.internal");
    expect(push).not.toHaveBeenCalled();
    expect(titleInput()).toHaveValue("Operator magazynu");
  });
});

describe("JobWizard: edycja opublikowanej oferty w trakcie „Zapisz zmiany” (#829)", () => {
  function renderEdit() {
    return render(
      <JobWizard
        initialJobId={JOB}
        initialValues={DRAFT}
        published={{ status: "active", slug: "magazynier-abc", updatedAt: "2026-09-24T10:00:00+00:00" }}
      />,
    );
  }

  it("zmiana w trakcie zapisu: bez „Zapisano”, kolejne „Zapisz zmiany” wysyła nowszą wartość", async () => {
    let resolveSave: (value: unknown) => void = () => {};
    updatePublishedJob.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveSave = resolve;
        }),
    );
    updatePublishedJob.mockResolvedValue({ ok: true, slug: "magazynier-abc", updatedAt: "2026-09-24T10:06:00+00:00" });
    renderEdit();

    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    resolveSave({ ok: true, slug: "magazynier-abc", updatedAt: "2026-09-24T10:05:00+00:00" });

    await waitFor(() => expect(screen.getByRole("button", { name: "saveChanges" })).toBeEnabled());
    expect(screen.queryByText("editSaved")).toBeNull();
    expect(screen.getByText("editSaveHint")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
    await screen.findByText("editSaved");
    const second = updatePublishedJob.mock.calls[1];
    expect((second?.[1] as Array<{ title?: string }>)[0]?.title).toBe("Operator magazynu");
    // Druga próba z nową wersją — bez fałszywego konfliktu.
    expect(second?.[2]).toBe("2026-09-24T10:05:00+00:00");
  });

  it("bez zmian w trakcie zapisu: „Zapisano”", async () => {
    updatePublishedJob.mockResolvedValue({ ok: true, slug: "magazynier-abc", updatedAt: "2026-09-24T10:05:00+00:00" });
    renderEdit();

    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));

    await screen.findByText("editSaved");
    expect(updatePublishedJob).toHaveBeenCalledTimes(1);
  });
});
