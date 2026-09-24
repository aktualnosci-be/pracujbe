import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #325 — kreator w trybie edycji opublikowanej oferty: kroki nie zapisują się pojedynczo
 * (brak updateJobDraft/publishJob), „Zapisz zmiany" wysyła całość jednym updatePublishedJob
 * z wczytaną wersją, a błąd w innym kroku przenosi do niego zamiast zapisywać.
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
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
  useLocale: () => "pl",
}));

const JOB = "11111111-1111-4111-8111-111111111111";
const VERSION = "2026-09-24T10:00:00.123456+00:00";

const PUBLISHED: JobWizardInitialValues = {
  title: "Operator wózka widłowego",
  category: "warehouse",
  occupation: "Operator wózka",
  contractType: "permanent",
  workingHours: "38 h / tydzień",
  city: "Antwerpia",
  region: "Flandria",
  description: "Obsługa wózka widłowego w magazynie centralnym, załadunek i rozładunek.",
  responsibilities: ["Załadunek towaru"],
  requirementsMandatory: ["Uprawnienia UDT"],
  companyDescription: "Rodzinna firma logistyczna z Antwerpii.",
  contactEmail: "hr@example.be",
};

function renderEdit(values: JobWizardInitialValues = PUBLISHED, status: "active" | "paused" = "active") {
  return render(
    <JobWizard
      initialJobId={JOB}
      initialValues={values}
      published={{ status, slug: "operator-wozka-abc", updatedAt: VERSION }}
    />,
  );
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  updatePublishedJob.mockResolvedValue({
    ok: true,
    slug: "operator-wozka-abc",
    updatedAt: "2026-09-24T10:05:00+00:00",
  });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("JobWizard — edycja opublikowanej oferty (#325)", () => {
  it("pokazuje tryb edycji z linkiem do publicznej oferty i bez „Zapisz i wyjdź”", () => {
    renderEdit();
    expect(screen.getByRole("heading", { level: 1, name: "editTitle" })).toBeInTheDocument();
    expect(screen.getByText("editSubtitleActive")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "viewOffer" })).toHaveAttribute(
      "href",
      "/oferty-pracy/operator-wozka-abc",
    );
    expect(screen.queryByRole("button", { name: "saveExit" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "cancel" })).toHaveAttribute("href", "/employer/oferty");
  });

  it("wstrzymana oferta: własny opis i brak linku do (niepublicznej) oferty", () => {
    renderEdit(PUBLISHED, "paused");
    expect(screen.getByText("editSubtitlePaused")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "viewOffer" })).not.toBeInTheDocument();
  });

  it("„Dalej” tylko waliduje krok — nic nie zapisuje w bazie", async () => {
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByRole("heading", { level: 2, name: "step2Title" });
    expect(updateJobDraft).not.toHaveBeenCalled();
    expect(createJobDraft).not.toHaveBeenCalled();
    expect(updatePublishedJob).not.toHaveBeenCalled();
  });

  it("„Zapisz zmiany” z kroku 1 wysyła wszystkie 9 kroków naraz z wczytaną wersją, potem nową", async () => {
    renderEdit();
    fireEvent.change(screen.getByLabelText("titleLabel"), {
      target: { value: "Operator wózka – zmiana nocna" },
    });
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));

    await waitFor(() => expect(updatePublishedJob).toHaveBeenCalledTimes(1));
    const [id, stepsData, version] = updatePublishedJob.mock.calls[0]!;
    expect(id).toBe(JOB);
    expect(version).toBe(VERSION);
    expect(stepsData).toHaveLength(9);
    expect(stepsData[0]).toMatchObject({ title: "Operator wózka – zmiana nocna" });
    expect(await screen.findByRole("status")).toHaveTextContent("editSaved");
    expect(publishJob).not.toHaveBeenCalled();
    expect(updateJobDraft).not.toHaveBeenCalled();

    // Kolejna poprawka używa wersji zwróconej przez zapis (bez fałszywego konfliktu).
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));
    await waitFor(() => expect(updatePublishedJob).toHaveBeenCalledTimes(2));
    expect(updatePublishedJob.mock.calls[1]![2]).toBe("2026-09-24T10:05:00+00:00");
  });

  it("kontrola ujemna: brak wymagań obowiązkowych przenosi do kroku 6 i nie zapisuje", async () => {
    renderEdit({ ...PUBLISHED, requirementsMandatory: [] });
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));

    await screen.findByRole("heading", { level: 2, name: "step6Title" });
    expect(screen.getByRole("alert")).toHaveTextContent('editFixStep:{"step":6,"title":"step6Title"}');
    expect(updatePublishedJob).not.toHaveBeenCalled();
  });

  it("konflikt wersji: komunikat z kodu i link do listy ofert", async () => {
    updatePublishedJob.mockResolvedValue({ ok: false, error: "JOB_EDIT_CONFLICT" });
    renderEdit();
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.jobEditConflict");
    expect(screen.getByRole("link", { name: "goToOffers" })).toHaveAttribute("href", "/employer/oferty");
  });
});
