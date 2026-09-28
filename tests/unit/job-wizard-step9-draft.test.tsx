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
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "pl",
}));

/** Kompletny, poprawny szkic — pozwala przejść kroki 1–8 samym „Dalej”. */
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

function step9Calls(): unknown[][] {
  return updateJobDraft.mock.calls.filter((call) => call[1] === 9);
}

describe("JobWizard krok 9: szkic bez zgody na publikację (#193)", () => {
  it("„Zapisz i wyjdź” bez zgody zapisuje opis i kontakt i wraca do panelu", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(9);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/employer"));
    expect(step9Calls()).toHaveLength(1);
    expect(step9Calls()[0]?.[2]).toMatchObject({
      companyDescription: FULL_DRAFT.companyDescription,
      contactEmail: FULL_DRAFT.contactEmail,
      agreePublish: false,
    });
    expect(publishJob).not.toHaveBeenCalled();
    expect(screen.getByRole("checkbox", { name: "agreePublish" })).not.toHaveAttribute(
      "aria-invalid",
    );
  });

  it("„Publikuj” bez zgody nie zapisuje ani nie publikuje i wskazuje pole zgody", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(9);

    fireEvent.click(screen.getByRole("button", { name: "publish" }));

    const consent = screen.getByRole("checkbox", { name: "agreePublish" });
    await waitFor(() => expect(consent).toHaveFocus());
    expect(consent).toHaveAttribute("aria-invalid", "true");
    expect(consent).toHaveAttribute("aria-describedby", "job-agreePublish-error");
    expect(document.getElementById("job-agreePublish-error")).toHaveTextContent(
      "publishAgreementRequired",
    );
    expect(step9Calls()).toHaveLength(0);
    expect(publishJob).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("„Publikuj” ze zgodą zapisuje krok i publikuje", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(9);

    fireEvent.click(screen.getByRole("checkbox", { name: "agreePublish" }));
    fireEvent.click(screen.getByRole("button", { name: "publish" }));

    await waitFor(() => expect(publishJob).toHaveBeenCalledWith("job-1"));
    expect(step9Calls()).toHaveLength(1);
    await waitFor(() => expect(push).toHaveBeenCalledWith("/employer"));
  });

  it("błąd zapisu szkicu nie udaje sukcesu i nie opuszcza kreatora", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(9);
    updateJobDraft.mockResolvedValueOnce({ ok: false, error: "INTERNAL" });

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.internal");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("JobWizard krok 9: kanał aplikowania (#1129)", () => {
  const NO_CHANNEL: JobWizardInitialValues = { ...FULL_DRAFT, applyEmail: "" };

  it("„Publikuj” bez kanału: błąd przy polu strony, fokus, bez zapisu i publikacji", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={NO_CHANNEL} />);
    await goToStep(9);

    fireEvent.click(screen.getByRole("checkbox", { name: "agreePublish" }));
    fireEvent.click(screen.getByRole("button", { name: "publish" }));

    const url = screen.getByLabelText("applyUrlLabel");
    await waitFor(() => expect(url).toHaveFocus());
    expect(url).toHaveAttribute("aria-invalid", "true");
    expect(url.getAttribute("aria-describedby")).toContain("job-applyUrl-error");
    expect(url.getAttribute("aria-describedby")).toContain("job-applyUrl-hint");
    expect(document.getElementById("job-applyUrl-error")).toHaveTextContent("applyChannelRequired");
    expect(step9Calls()).toHaveLength(0);
    expect(publishJob).not.toHaveBeenCalled();
  });

  it("„Zapisz i wyjdź” bez kanału zapisuje szkic (kanał wymagany dopiero przy publikacji)", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={NO_CHANNEL} />);
    await goToStep(9);

    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/employer"));
    expect(step9Calls()).toHaveLength(1);
    expect(step9Calls()[0]?.[2]).not.toHaveProperty("applyEmail", expect.any(String));
  });

  it("telefon w zapisie lokalnym z 00 trafia do akcji; niepoprawny format = błąd przy polu", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={NO_CHANNEL} />);
    await goToStep(9);
    const phone = screen.getByLabelText("applyPhoneLabel");

    fireEvent.change(phone, { target: { value: "0470 12 34 56" } });
    fireEvent.click(screen.getByRole("button", { name: "saveExit" }));
    await waitFor(() => expect(phone).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("job-applyPhone-error")).toHaveTextContent("applyPhoneInvalid");
    expect(step9Calls()).toHaveLength(0);

    fireEvent.change(phone, { target: { value: "0032 470 12 34 56" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "agreePublish" }));
    fireEvent.click(screen.getByRole("button", { name: "publish" }));
    await waitFor(() => expect(publishJob).toHaveBeenCalledWith("job-1"));
    expect(step9Calls()[0]?.[2]).toMatchObject({ applyPhone: "0032 470 12 34 56" });
  });

  it("odmowa bazy JOB_APPLY_CHANNEL_REQUIRED wraca komunikatem przy polu", async () => {
    publishJob.mockResolvedValueOnce({ ok: false, error: "JOB_APPLY_CHANNEL_REQUIRED" });
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(9);

    fireEvent.click(screen.getByRole("checkbox", { name: "agreePublish" }));
    fireEvent.click(screen.getByRole("button", { name: "publish" }));

    const url = screen.getByLabelText("applyUrlLabel");
    await waitFor(() => expect(url).toHaveAttribute("aria-invalid", "true"));
    expect(document.getElementById("job-applyUrl-error")).toHaveTextContent("applyChannelRequired");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("JobWizard: „Dalej” w trakcie zapisu (Invariant #11)", () => {
  it("drugie kliknięcie przed końcem zapisu jest pomijane, krok zmienia się po zapisie", async () => {
    let resolveSave: (value: { ok: true; demo: false }) => void = () => {};
    updateJobDraft.mockImplementationOnce(
      () => new Promise((resolve) => {
        resolveSave = resolve;
      }),
    );
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);

    fireEvent.click(screen.getByRole("button", { name: "next" }));
    // Akcja wywołana od razu, ale krok jeszcze 1 i przycisk zablokowany — dlatego pomocnik
    // czeka na nagłówek kolejnego kroku, a nie na samo wywołanie `updateJobDraft`.
    expect(updateJobDraft).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    expect(updateJobDraft).toHaveBeenCalledTimes(1);

    resolveSave({ ok: true, demo: false });
    await waitForStep(2);
    expect(updateJobDraft).toHaveBeenCalledTimes(1);
  });
});

describe("JobWizard: za długa pozycja listy (#364)", () => {
  it("odrzuca pozycję z komunikatem przy polu i zostawia wpis do skrócenia", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    await goToStep(5);
    const input = await screen.findByLabelText("responsibilitiesLabel");
    const long = "x".repeat(501);

    fireEvent.change(input, { target: { value: long } });
    fireEvent.click(screen.getAllByRole("button", { name: "add" })[0]!);

    expect(input).toHaveValue(long);
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-describedby", "job-responsibilities-draft-error");
    expect(document.getElementById("job-responsibilities-draft-error")).toHaveTextContent(
      "itemTooLongMax",
    );
    expect(screen.queryByText(long)).toBeNull();

    fireEvent.change(input, { target: { value: "Kontrola jakości" } });
    expect(input).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getAllByRole("button", { name: "add" })[0]!);
    expect(screen.getByText("Kontrola jakości")).toBeInTheDocument();
    expect(input).toHaveValue("");
  });
});
