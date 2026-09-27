import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard, type JobWizardInitialValues } from "@/components/employer/JobWizard";

/**
 * P1-10 — podpowiedź miasta w kreatorze: rozpoznana miejscowość ze słownika albo informacja
 * o braku, propozycje w `datalist`. Wpisany tekst nie jest podmieniany; błąd odczytu = brak
 * podpowiedzi (bez blokowania kreatora).
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
  title: "Operator wózka widłowego",
  category: "warehouse",
  occupation: "Operator wózka",
  contractType: "permanent",
  workingHours: "38 h / tydzień",
  city: "  ANTWERPEN ",
  region: "Flandria",
  description: "Obsługa wózka widłowego w magazynie centralnym, załadunek i rozładunek.",
  responsibilities: ["Załadunek towaru"],
  requirementsMandatory: ["Uprawnienia UDT"],
  companyDescription: "Rodzinna firma logistyczna z Antwerpii.",
  contactEmail: "hr@example.be",
};

async function openCityStep() {
  render(
    <JobWizard
      initialJobId={JOB}
      initialValues={VALUES}
      published={{ status: "active", slug: "operator-wozka-abc", updatedAt: "2026-09-24T10:00:00+00:00" }}
    />,
  );
  // Tryb edycji: „Dalej” tylko waliduje krok (bez zapisu) — szybka droga do kroku 3.
  fireEvent.click(screen.getByRole("button", { name: "next" }));
  fireEvent.click(await screen.findByRole("button", { name: "next" }));
  return screen.findByLabelText("cityLabel");
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

describe("JobWizard: podpowiedź miasta (P1-10)", () => {
  it("rozpoznana miejscowość: komunikat powiązany z polem, propozycje, tekst bez zmian", async () => {
    jobCityAssist.mockResolvedValue({
      status: "ok", match: { slug: "antwerp", name: "Antwerpia" }, suggestions: ["Antwerpen", "Antwerpia"],
    });
    const city = await openCityStep();
    const hint = document.getElementById("job-city-hint")!;
    await waitFor(() => expect(hint).toHaveTextContent('cityRecognized:{"name":"Antwerpia"}'));
    expect(jobCityAssist).toHaveBeenCalledWith({ city: "  ANTWERPEN ", locale: "pl" });
    expect(city).toHaveAttribute("aria-describedby", "job-city-hint");
    expect(city).toHaveAttribute("list", "job-city-suggestions");
    const options = [...document.querySelectorAll("#job-city-suggestions option")].map((o) => o.getAttribute("value"));
    expect(options).toEqual(["Antwerpen", "Antwerpia"]);
    expect(city).toHaveValue("  ANTWERPEN ");
  });

  it("nazwa spoza słownika: jawna informacja (kontrola ujemna względem dopasowania)", async () => {
    jobCityAssist.mockResolvedValue({ status: "ok", match: null, suggestions: [] });
    await openCityStep();
    const hint = document.getElementById("job-city-hint")!;
    await waitFor(() => expect(hint).toHaveTextContent("cityNotRecognized"));
    expect(hint).not.toHaveTextContent("cityRecognized:");
  });

  it("błąd odczytu słownika: brak podpowiedzi, pole działa dalej", async () => {
    jobCityAssist.mockResolvedValue({ status: "error" });
    const city = await openCityStep();
    await waitFor(() => expect(jobCityAssist).toHaveBeenCalled());
    expect(document.getElementById("job-city-hint")).toHaveTextContent("");
    fireEvent.change(city, { target: { value: "Gent" } });
    await waitFor(() => expect(jobCityAssist).toHaveBeenLastCalledWith({ city: "Gent", locale: "pl" }));
  });
});
