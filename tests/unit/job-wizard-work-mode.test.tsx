import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * #792 (0956): krok 3 kreatora — tryb pracy (na miejscu / hybrydowa / w pełni zdalna) zamiast
 * pola „Praca zdalna”; przy pracy w pełni zdalnej lista krajów kandydata (co najmniej jeden).
 */

const { jobCityAssist, updatePublishedJob, push } = vi.hoisted(() => ({
  jobCityAssist: vi.fn(),
  updatePublishedJob: vi.fn(),
  push: vi.fn(),
}));

vi.mock("@/lib/actions/job-location", () => ({ jobCityAssist }));
vi.mock("@/lib/actions/jobs", () => ({
  createJobDraft: vi.fn(), updateJobDraft: vi.fn(), publishJob: vi.fn(), updatePublishedJob,
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
  title: "Konsultant obsługi klienta",
  category: "warehouse",
  occupation: "Konsultant",
  contractType: "permanent",
  workingHours: "38 h / tydzień",
  city: "Gent",
  region: "Flandria",
  description: "Obsługa klientów przez telefon i czat, praca z domu przez cały czas.",
  responsibilities: ["Rozmowy z klientami"],
  requirementsMandatory: ["Komputer"],
  companyDescription: "Firma usługowa z Gandawy.",
  contactEmail: "hr@example.be",
  applyEmail: "praca@example.be",
};

async function openStep3(values: JobWizardInitialValues) {
  render(
    <JobWizard
      initialJobId={JOB}
      initialValues={values}
      published={{ status: "active", slug: "konsultant-abc", updatedAt: "2026-09-24T10:00:00+00:00" }}
    />,
  );
  // Tryb edycji: „Dalej” tylko waliduje krok (bez zapisu) — szybka droga do kroku 3.
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  fireEvent.click(await screen.findByRole("button", { name: "next" }));
  await screen.findByLabelText("cityLabel");
}

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  jobCityAssist.mockResolvedValue({ status: "ok", match: null, suggestions: [] });
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

describe("JobWizard: tryb pracy (#792)", () => {
  it("brak pola „Praca zdalna”; tryb pracy jako lista z trzema wariantami", async () => {
    await openStep3({ ...VALUES, workMode: "onsite", remoteApplicantCountries: [] });
    expect(screen.queryByLabelText("remote")).toBeNull();
    const trigger = screen.getByRole("combobox", { name: "workModeLabel" });
    expect(trigger).toHaveTextContent("workMode.onsite");
    // Na miejscu: bez listy krajów.
    expect(screen.queryByRole("group", { name: "remoteCountriesLegend" })).toBeNull();
  });

  it("praca w pełni zdalna bez kraju: błąd przy liście krajów, fokus na pierwszym kraju, krok bez zmian", async () => {
    await openStep3({ ...VALUES, workMode: "remote", remoteApplicantCountries: [] });
    const group = screen.getByRole("group", { name: "remoteCountriesLegend" });
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(within(group).getByText("job.error.remoteCountriesRequired")).toBeInTheDocument());
    const first = within(group).getAllByRole("checkbox")[0]!;
    expect(first).toHaveFocus();
    expect(screen.getByLabelText("cityLabel")).toBeInTheDocument();

    // Zaznaczenie kraju usuwa błąd i pozwala przejść dalej.
    fireEvent.click(within(group).getByRole("checkbox", { name: "BE" }));
    expect(within(group).queryByText("job.error.remoteCountriesRequired")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(screen.queryByLabelText("cityLabel")).toBeNull());
  });

  it("kontrola ujemna: praca hybrydowa nie wymaga i nie pokazuje krajów", async () => {
    await openStep3({ ...VALUES, workMode: "hybrid", remoteApplicantCountries: [] });
    expect(screen.queryByRole("group", { name: "remoteCountriesLegend" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(screen.queryByLabelText("cityLabel")).toBeNull());
  });

  it("stara oferta bez trybu (dawne remote = true): tryb nieznany, bez zgadywania „w pełni zdalna”", async () => {
    await openStep3({ ...VALUES, remote: true, workMode: "", remoteApplicantCountries: [] });
    const trigger = screen.getByRole("combobox", { name: "workModeLabel" });
    expect(trigger).toHaveTextContent("costsUnset");
    expect(trigger).not.toHaveTextContent("workMode.remote");
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(screen.queryByLabelText("cityLabel")).toBeNull());
  });
});
