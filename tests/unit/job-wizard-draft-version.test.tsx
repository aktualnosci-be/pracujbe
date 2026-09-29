import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #1070 — token wersji szkicu w kreatorze: wersja wczytana z serwera (`draftVersion`) albo
 * zwrócona przez poprzedni zapis trafia jako czwarty argument `updateJobDraft`; konflikt
 * (`JOB_EDIT_CONFLICT`) ma własny komunikat i link do przeładowania; krok bez zmian od ostatniego
 * udanego zapisu nie wysyła żądania. Dowód po stronie bazy: `rls.sql` sekcja DC1070.
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

const V0 = "2026-09-29T10:00:00.000001+00:00";
const V1 = "2026-09-29T10:00:05.000002+00:00";
const V2 = "2026-09-29T10:00:09.000003+00:00";

function titleInput(): HTMLElement {
  return screen.getByLabelText("titleLabel");
}

/** Wersje przekazane do kolejnych zapisów kroku 1 (czwarty argument akcji). */
function versionsSent(): unknown[] {
  return updateJobDraft.mock.calls.filter((call) => call[1] === 1).map((call) => call[3]);
}

async function nextAndBack(): Promise<void> {
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  await screen.findByText("step2Title", { selector: "h2" });
  fireEvent.click(screen.getByRole("button", { name: "back" }));
  await screen.findByText("step1Title", { selector: "h2" });
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("JobWizard: token wersji szkicu (#1070)", () => {
  it("wznowiony szkic wysyła wersję z loadera, a kolejny zapis wersję z poprzedniej odpowiedzi", async () => {
    updateJobDraft
      .mockResolvedValueOnce({ ok: true, version: V1 })
      .mockResolvedValueOnce({ ok: true, version: V2 });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} draftVersion={V0} />);

    await nextAndBack();
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByText("step2Title", { selector: "h2" });

    expect(versionsSent()).toEqual([V0, V1]);
    // Kontrola ujemna: gdyby kreator zawsze odsyłał wersję z loadera, drugi zapis niósłby V0.
    expect(versionsSent()[1]).not.toBe(V0);
  });

  it("świeży szkic tej karty: pierwszy zapis bez tokenu, kolejne z wersją z odpowiedzi", async () => {
    createJobDraft.mockResolvedValue({ ok: true, id: JOB });
    updateJobDraft.mockResolvedValueOnce({ ok: true, version: V1 }).mockResolvedValue({ ok: true, version: V2 });
    render(<JobWizard initialValues={DRAFT} />);

    await nextAndBack();
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByText("step2Title", { selector: "h2" });

    expect(createJobDraft).toHaveBeenCalledTimes(1);
    expect(versionsSent()).toEqual([null, V1]);
  });

  it("zapis w trakcie edycji (#829) używa świeżej wersji: ponowny zapis niesie wersję z pierwszej odpowiedzi", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    updateJobDraft.mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }));
    updateJobDraft.mockResolvedValue({ ok: true, version: V2 });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} draftVersion={V0} />);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    resolveFirst({ ok: true, version: V1 });

    await waitFor(() => expect(push).toHaveBeenCalledWith("/employer"));
    expect(versionsSent()).toEqual([V0, V1]);
  });
});

describe("JobWizard: konflikt szkicu (#1070)", () => {
  it("pokazuje komunikat konfliktu i link do przeładowania szkicu, bez linku do listy", async () => {
    updateJobDraft.mockResolvedValue({ ok: false, error: "JOB_EDIT_CONFLICT" });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} draftVersion={V0} />);

    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(await screen.findByText("draftConflict")).toBeInTheDocument();
    const reload = screen.getByRole("link", { name: "reloadDraft" });
    expect(reload).toHaveAttribute("href", `/pl/employer/oferty/${JOB}/edycja`);
    expect(screen.queryByRole("link", { name: "goToOffers" })).toBeNull();
    // Konflikt nie przechodzi do następnego kroku — dane zostają w formularzu.
    expect(screen.queryByText("step2Title", { selector: "h2" })).toBeNull();
    expect(titleInput()).toHaveValue("Magazynier");
  });

  it("kontrola ujemna: inny błąd zapisu nie pokazuje komunikatu konfliktu ani linku przeładowania", async () => {
    updateJobDraft.mockResolvedValue({ ok: false, error: "JOB_NOT_DRAFT" });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} draftVersion={V0} />);

    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(await screen.findByRole("link", { name: "goToOffers" })).toBeInTheDocument();
    expect(screen.queryByText("draftConflict")).toBeNull();
    expect(screen.queryByRole("link", { name: "reloadDraft" })).toBeNull();
  });

  it("kontrola ujemna: konflikt w trybie edycji opublikowanej oferty zostaje przy liście ofert", async () => {
    updatePublishedJob.mockResolvedValue({ ok: false, error: "JOB_EDIT_CONFLICT" });
    render(
      <JobWizard
        initialJobId={JOB}
        initialValues={DRAFT}
        published={{ status: "active", slug: "magazynier", updatedAt: V0 }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "saveChanges" }));

    expect(await screen.findByRole("link", { name: "goToOffers" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "reloadDraft" })).toBeNull();
    expect(screen.queryByText("draftConflict")).toBeNull();
  });
});

describe("JobWizard: krok bez zmian nie wysyła zapisu (#1070)", () => {
  it("powrót i ponowne „Dalej” bez zmian = jeden zapis; po zmianie pola zapis się powtarza", async () => {
    updateJobDraft.mockResolvedValue({ ok: true, version: V1 });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} draftVersion={V0} />);

    await nextAndBack();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByText("step2Title", { selector: "h2" });
    expect(updateJobDraft).toHaveBeenCalledTimes(1);

    // Kontrola ujemna: realna zmiana kroku wysyła zapis (z wersją z odpowiedzi).
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    await screen.findByText("step1Title", { selector: "h2" });
    fireEvent.change(titleInput(), { target: { value: "Operator magazynu" } });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByText("step2Title", { selector: "h2" });
    expect(updateJobDraft).toHaveBeenCalledTimes(2);
    expect(versionsSent()).toEqual([V0, V1]);
  });

  it("nieudany zapis nie zapamiętuje kroku — ponowienie bez zmian znów wysyła żądanie", async () => {
    updateJobDraft
      .mockResolvedValueOnce({ ok: false, error: "INTERNAL" })
      .mockResolvedValue({ ok: true, version: V1 });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} draftVersion={V0} />);

    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByText("step2Title", { selector: "h2" });

    expect(updateJobDraft).toHaveBeenCalledTimes(2);
  });
});
