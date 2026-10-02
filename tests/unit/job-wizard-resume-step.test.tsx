import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, resumeWizardStep, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #834 — „Dokończ szkic” wznawia kreator na najdalszym kroku z udanym zapisem (`jobs.draft_step`
 * z loadera → prop `initialStep`). Samo wznowienie i zmiana kroku niczego nie zapisują; stare
 * szkice (brak postępu), nowa oferta i edycja opublikowanej oferty zaczynają od kroku 1.
 * Dowód po stronie bazy: `rls.sql` sekcja DS834.
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
  salaryMin: "16",
  salaryMax: "18",
  currency: "EUR",
  salaryPeriod: "hour",
  description: "Obsługa wózka widłowego w magazynie centralnym, załadunek i rozładunek.",
  responsibilities: ["Załadunek towaru"],
  requirementsMandatory: ["Uprawnienia UDT"],
  companyDescription: "Rodzinna firma logistyczna z Antwerpii.",
  contactEmail: "hr@example.be",
  applyEmail: "praca@example.be",
};

/** Tytuł bieżącego kroku (nagłówek h2 kroku zawiera numer i tytuł). */
function currentHeading(): string {
  const titles = Array.from(document.querySelectorAll("h2"))
    .map((h) => /step\dTitle/.exec(h.textContent ?? "")?.[0])
    .filter(Boolean);
  expect(titles).toHaveLength(1);
  return titles[0]!;
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

describe("resumeWizardStep (#834)", () => {
  it("zapisany krok 1–9 = krok startowy", () => {
    for (let s = 1; s <= 9; s += 1) expect(resumeWizardStep(s)).toBe(s);
  });

  it("kontrole ujemne: brak, 0, 10, ułamek, NaN = krok 1", () => {
    for (const v of [undefined, null, 0, -1, 10, 4.5, Number.NaN]) expect(resumeWizardStep(v)).toBe(1);
  });
});

describe("JobWizard: wznowienie szkicu od zapisanego kroku (#834)", () => {
  it("szkic z postępem 4 otwiera się na kroku 4 bez żadnego zapisu", () => {
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} initialStep={4} />);

    expect(currentHeading()).toBe("step4Title");
    expect(updateJobDraft).not.toHaveBeenCalled();
    expect(createJobDraft).not.toHaveBeenCalled();
  });

  it("„Wstecz” prowadzi do wcześniejszych kroków bez zapisu szkicu", async () => {
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} initialStep={4} />);

    fireEvent.click(screen.getByRole("button", { name: "back" }));
    await screen.findByText("step3Title", { selector: "h2" });
    fireEvent.click(screen.getByRole("button", { name: "back" }));
    await screen.findByText("step2Title", { selector: "h2" });
    // Wczytane wartości wcześniejszych kroków są w formularzu.
    expect(screen.getByLabelText("workingHoursLabel")).toHaveValue("38 h / tydzień");
    expect(updateJobDraft).not.toHaveBeenCalled();
  });

  it("„Dalej” z kroku wznowienia zapisuje TEN krok i przechodzi do następnego", async () => {
    updateJobDraft.mockResolvedValue({ ok: true });
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} initialStep={4} />);

    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByText("step5Title", { selector: "h2" });
    expect(updateJobDraft).toHaveBeenCalledTimes(1);
    expect(updateJobDraft.mock.calls[0]?.[1]).toBe(4);
  });

  it("kontrola ujemna: stary szkic bez postępu i nieprawidłowa wartość zaczynają od kroku 1", () => {
    const { unmount } = render(<JobWizard initialJobId={JOB} initialValues={DRAFT} />);
    expect(currentHeading()).toBe("step1Title");
    unmount();
    render(<JobWizard initialJobId={JOB} initialValues={DRAFT} initialStep={12} />);
    expect(currentHeading()).toBe("step1Title");
  });

  it("kontrola ujemna: edycja opublikowanej oferty ignoruje postęp szkicu (krok 1)", () => {
    render(
      <JobWizard
        initialJobId={JOB}
        initialValues={DRAFT}
        initialStep={6}
        published={{ status: "active", slug: "magazynier-abc", updatedAt: "2026-09-29T10:00:00Z" }}
      />,
    );
    expect(currentHeading()).toBe("step1Title");
  });
});
