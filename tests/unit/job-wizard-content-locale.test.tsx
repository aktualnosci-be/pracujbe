import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #1048 (I18N-01): jawny „Język ogłoszenia” w kroku 1 kreatora; #1099 (EMP-05): jeden klucz
 * operacji tworzenia szkicu (ponowienie = ten sam szkic); #1099/#1095: nazwa dostępna
 * combobox’a poziomu języka w kroku 7.
 */
const { createJobDraft, updateJobDraft, push } = vi.hoisted(() => ({
  createJobDraft: vi.fn(),
  updateJobDraft: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/actions/jobs", () => ({
  createJobDraft,
  updateJobDraft,
  publishJob: vi.fn(),
  updatePublishedJob: vi.fn(),
}));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "pl",
}));

const STEP1: JobWizardInitialValues = {
  title: "Operator wózka widłowego",
  category: "warehouse",
  occupation: "Operator wózka",
};

const KEY_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  createJobDraft.mockResolvedValue({ ok: true, id: "job-1" });
  updateJobDraft.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function next(): HTMLButtonElement {
  const matches = Array.from(document.querySelectorAll("button")).filter((b) => b.textContent?.trim() === "next");
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

describe("JobWizard krok 1: język ogłoszenia (#1048)", () => {
  it("domyślnie język panelu; zapis kroku 1 niesie wybrany język", async () => {
    render(<JobWizard initialValues={STEP1} />);
    const trigger = document.getElementById("job-content-locale-trigger") as HTMLButtonElement;
    expect(trigger).toBeTruthy();
    expect(trigger).toHaveTextContent("job.contentLanguageNames.pl");
    expect(trigger).not.toBeDisabled();
    expect(screen.getByText("contentLocaleHint")).toBeInTheDocument();

    fireEvent.click(trigger);
    fireEvent.click(await screen.findByRole("option", { name: "job.contentLanguageNames.nl" }));
    fireEvent.click(next());

    await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(1));
    // Szkic powstaje od razu w wybranym języku, a krok 1 zapisuje ten sam język.
    expect(createJobDraft.mock.calls[0]?.[0]).toBe("nl");
    expect(updateJobDraft.mock.calls[0]?.[1]).toBe(1);
    expect(updateJobDraft.mock.calls[0]?.[2]).toMatchObject({ contentLocale: "nl" });
  });

  it("wznowiony szkic zaczyna od języka zapisanego w ofercie, nie od języka panelu", async () => {
    render(<JobWizard initialJobId="job-9" initialValues={STEP1} contentLocale="fr" />);
    expect(document.getElementById("job-content-locale-trigger")).toHaveTextContent("job.contentLanguageNames.fr");
    fireEvent.click(next());
    await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(1));
    expect(createJobDraft).not.toHaveBeenCalled();
    expect(updateJobDraft.mock.calls[0]?.[2]).toMatchObject({ contentLocale: "fr" });
  });

  it("opublikowana oferta: język zablokowany z wyjaśnieniem", () => {
    render(
      <JobWizard
        initialJobId="job-9"
        initialValues={STEP1}
        contentLocale="nl"
        published={{ status: "active", slug: "operator-abc", updatedAt: "2026-09-24T10:00:00+00:00" }}
      />,
    );
    expect(document.getElementById("job-content-locale-trigger")).toBeDisabled();
    expect(screen.getByText("contentLocaleLocked")).toBeInTheDocument();
    expect(screen.queryByText("contentLocaleHint")).toBeNull();
  });
});

describe("JobWizard: tworzenie szkicu idempotentne po kluczu operacji (#1099)", () => {
  it("ponowienie po błędzie używa tego samego klucza; nowy kreator ma nowy klucz", async () => {
    createJobDraft.mockResolvedValueOnce({ ok: false, error: "INTERNAL" });
    render(<JobWizard initialValues={STEP1} companyId="company-1" />);

    fireEvent.click(next());
    await waitFor(() => expect(createJobDraft).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(next()).toBeEnabled());
    fireEvent.click(next());
    await waitFor(() => expect(createJobDraft).toHaveBeenCalledTimes(2));

    const [first, second] = createJobDraft.mock.calls;
    expect(first?.[1]).toBe("company-1");
    expect(first?.[2]).toMatch(KEY_RE);
    // Kontrola ujemna: klucz losowany przy każdym wywołaniu dałby dwa różne szkice.
    expect(second?.[2]).toBe(first?.[2]);

    cleanup();
    render(<JobWizard initialValues={STEP1} companyId="company-1" />);
    fireEvent.click(next());
    await waitFor(() => expect(createJobDraft).toHaveBeenCalledTimes(3));
    expect(createJobDraft.mock.calls[2]?.[2]).not.toBe(first?.[2]);
  });
});

describe("JobWizard krok 7: nazwa poziomu języka (#1099/#1095)", () => {
  it("combobox poziomu ma nazwę z etykietą pola, nie samą wartość", async () => {
    render(
      <JobWizard
        initialJobId="job-9"
        initialValues={{
          ...STEP1,
          contractType: "permanent",
          workingHours: "38 h",
          city: "Antwerpia",
          region: "Flandria",
          description: "Obsługa wózka widłowego w magazynie centralnym, załadunek i rozładunek.",
          responsibilities: ["Załadunek towaru"],
          requirementsMandatory: ["Uprawnienia UDT"],
        }}
      />,
    );
    for (let s = 1; s < 7; s += 1) {
      fireEvent.click(next());
      await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(s));
      await waitFor(() =>
        expect(
          Array.from(document.querySelectorAll("h2")).some((h) =>
            h.textContent?.startsWith(`0${s + 1} / `),
          ),
        ).toBe(true),
      );
    }
    expect(document.querySelector('[role="combobox"][aria-label="languageLevelAria"]')).not.toBeNull();
    // Kontrola ujemna: dawna nazwa = sama wartość („levelBasic”) nie występuje.
    expect(document.querySelector('[role="combobox"][aria-label="levelBasic"]')).toBeNull();
  });
});
