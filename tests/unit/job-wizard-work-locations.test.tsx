import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #850 (0230): krok 3 kreatora — „Dodatkowe miejsca pracy”. Szkic: lista trafia do zapisu kroku 3
 * (`extraLocations`). Edycja opublikowanej oferty: lista tylko do podglądu (RPC zmienia ją w szkicu).
 */

const { jobCityAssist, updateJobDraft, updatePublishedJob, push } = vi.hoisted(() => ({
  jobCityAssist: vi.fn(),
  updateJobDraft: vi.fn(),
  updatePublishedJob: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/actions/job-location", () => ({ jobCityAssist }));
vi.mock("@/lib/actions/jobs", () => ({
  createJobDraft: vi.fn(), updateJobDraft, publishJob: vi.fn(), updatePublishedJob,
}));
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
const VALUES: JobWizardInitialValues = {
  title: "Mobilna ekipa sprzątająca",
  category: "cleaning",
  occupation: "Sprzątacz",
  contractType: "permanent",
  workingHours: "38 h / tydzień",
  city: "Genk",
  region: "Limburg",
  description: "Sprzątanie biur klientów w Kempen i Limburgii, dojazd busem firmowym.",
  responsibilities: ["Sprzątanie biur"],
  requirementsMandatory: ["Prawo jazdy B"],
  companyDescription: "Firma sprzątająca z Limburgii.",
  applyEmail: "praca@example.be",
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  jobCityAssist.mockResolvedValue({ status: "error" });
  updateJobDraft.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("JobWizard — dodatkowe miejsca pracy (#850)", () => {
  it("szkic: dodane miejsca trafiają do zapisu kroku 3", async () => {
    render(<JobWizard initialJobId={JOB} initialValues={{ ...VALUES, extraLocations: ["Mol"] }} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByRole("button", { name: "next" }));
    const input = await screen.findByLabelText("extraLocationsLabel");
    fireEvent.change(input, { target: { value: "Hasselt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("button", { name: "remove: Hasselt" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(3));
    const [, step, data] = updateJobDraft.mock.calls[2]!;
    expect(step).toBe(3);
    expect(data).toMatchObject({ city: "Genk", extraLocations: ["Mol", "Hasselt"] });
  });

  it("edycja opublikowanej oferty: lista bez pola dodawania i z informacją o szkicu", async () => {
    render(
      <JobWizard
        initialJobId={JOB}
        initialValues={{ ...VALUES, extraLocations: ["Hasselt", "Mol"] }}
        published={{ status: "active", slug: "mobilna-ekipa", updatedAt: "2026-09-24T10:00:00+00:00" }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    fireEvent.click(await screen.findByRole("button", { name: "next" }));
    await screen.findByLabelText("cityLabel");
    expect(screen.getByText("extraLocationsLocked")).toBeTruthy();
    const list = document.getElementById("job-extraLocations")!;
    expect(list.tagName).toBe("UL");
    expect(within(list).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Hasselt", "Mol"]);
    // Kontrola ujemna: w edycji nie ma przycisku usuwania pozycji listy.
    expect(screen.queryByRole("button", { name: "remove: Hasselt" })).toBeNull();
  });
});
