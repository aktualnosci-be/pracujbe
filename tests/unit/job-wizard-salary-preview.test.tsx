import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JobWizard,
  type JobWizardInitialValues,
} from "@/components/employer/JobWizard";

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
// Tłumacz z parametrem `value` (etykiety „od/do” paszportu), żeby test widział kwotę.
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: { value?: string }) =>
    values?.value !== undefined ? `${key}[${values.value}]` : key,
  useLocale: () => "pl",
}));

/** Kompletny, poprawny szkic — pozwala przejść kroki 1–8 samym „Dalej” (#1224). */
const FULL_DRAFT: JobWizardInitialValues = {
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
  applyEmail: "praca@example.be",
};

function installDomShims(): void {
  Element.prototype.scrollIntoView = vi.fn();
  // Radix Checkbox mierzy kontrolkę przez ResizeObserver, którego jsdom nie ma.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

/**
 * Rozgrzewka: jedno przejście kreatora do kroku 9 przed testami (limit hooka 10 s). Pierwszy
 * render każdego kroku płaci jednorazowo kompilację JIT komponentów i ich zależności — przy
 * pełnym `npm run verify` na obciążonej maszynie właśnie pierwszy test pliku przekraczał 5 s,
 * choć kolejne, identyczne przejścia mieściły się z zapasem. Stan (DOM, atrapy) jest potem
 * czyszczony, więc testy startują od zera jak wcześniej.
 */
beforeAll(async () => {
  installDomShims();
  updateJobDraft.mockResolvedValue({ ok: true, demo: false });
  render(<JobWizard initialJobId="job-warmup" initialValues={FULL_DRAFT} />);
  await goToStep(9);
  cleanup();
  vi.resetAllMocks();
});

beforeEach(() => {
  installDomShims();
  updateJobDraft.mockResolvedValue({ ok: true, demo: false });
  publishJob.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

/**
 * Przycisk stopki kreatora po samym tekście. W pętli przejść kroków celowo NIE używamy
 * `getByRole`: w jsdom liczy on nazwę dostępną i widoczność (getComputedStyle w górę drzewa)
 * dla każdego przycisku dużego formularza, a `waitFor` powtarza zapytanie co 50 ms — pod
 * obciążeniem samo przejście do kroku 9 trwało kilka sekund (limit 5 s). Asercje, które
 * sprawdzają rolę i nazwę dostępną (zgoda, „saveExit”, „publish”, alert), zostają przy
 * zapytaniach po roli w treści testów.
 */
function wizardButton(label: string): HTMLButtonElement {
  const matches = Array.from(document.querySelectorAll("button")).filter(
    (b) => b.textContent?.trim() === label,
  );
  expect(matches).toHaveLength(1);
  return matches[0]!;
}

/** Nagłówek kroku (`<h2>` z prefiksem „0n / ”) — tanie zapytanie DOM zamiast `getAllByRole`. */
function stepHeadingShows(prefix: string): boolean {
  return Array.from(document.querySelectorAll("h2")).some((h) =>
    h.textContent?.startsWith(prefix),
  );
}

/**
 * Czeka, aż kreator POKAŻE krok `n` (nagłówek „0n / …”). Samo wywołanie `updateJobDraft`
 * nie wystarcza: akcja jest wołana synchronicznie w kliknięciu, a krok zmienia się dopiero
 * po jej rozwiązaniu — kolejne „Dalej” w tym oknie trafiało w zablokowany przycisk (zapis
 * w toku) i przejście przepadało („called 2 times, expected 3”).
 */
async function waitForStep(n: number): Promise<void> {
  const prefix = `${String(n).padStart(2, "0")} / `;
  await waitFor(() => expect(stepHeadingShows(prefix)).toBe(true));
  expect(wizardButton(n < 9 ? "next" : "publish")).toBeEnabled();
}

async function goToStep(target: number): Promise<void> {
  for (let s = 1; s < target; s += 1) {
    fireEvent.click(wizardButton("next"));
    await waitForStep(s + 1);
    expect(updateJobDraft).toHaveBeenCalledTimes(s);
  }
  if (target === 9) await screen.findByRole("checkbox", { name: "agreePublish" });
}

/** Wartość wiersza podglądu „jak zobaczą kandydaci” z etykietą okresu wynagrodzenia. */
function salaryPreview(): string {
  const row = Array.from(document.querySelectorAll("dt")).find(
    (dt) => dt.textContent === "salaryPeriodLabel",
  );
  expect(row).toBeDefined();
  return row!.nextElementSibling?.textContent ?? "";
}

const eur = (amount: number): string =>
  new Intl.NumberFormat("pl", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);

describe("JobWizard krok 9: podgląd wynagrodzenia = wspólny formater (#1224)", () => {
  it("sama górna granica: „do …” w walucie locale i okres z paszportu", async () => {
    render(
      <JobWizard
        initialJobId="job-1"
        initialValues={{ ...FULL_DRAFT, salaryMax: "3000", salaryPeriod: "month" }}
      />,
    );
    await goToStep(9);
    expect(salaryPreview()).toBe(
      `jobs.passport.salaryTo[${eur(3000)}] jobs.passport.salaryPeriods.month`,
    );
    // Kontrola ujemna: dawny zapis surowych pól formularza.
    expect(salaryPreview()).not.toContain("3000 EUR");
  });

  it("widełki: obie granice w walucie locale, separator tysięcy, bez kodu waluty", async () => {
    render(
      <JobWizard
        initialJobId="job-1"
        initialValues={{ ...FULL_DRAFT, salaryMin: "12500", salaryMax: "15000", salaryPeriod: "year" }}
      />,
    );
    await goToStep(9);
    expect(salaryPreview()).toBe(`${eur(12500)} – ${eur(15000)} jobs.passport.salaryPeriods.year`);
    expect(salaryPreview()).not.toContain("EUR");
  });

  it("bez kwoty: „nie podano”", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(9);
    expect(salaryPreview()).toBe("previewSalaryNotProvided");
  });
});
