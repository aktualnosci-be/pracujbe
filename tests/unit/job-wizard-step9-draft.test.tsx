import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // Radix Checkbox mierzy kontrolkę przez ResizeObserver, którego jsdom nie ma.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  updateJobDraft.mockResolvedValue({ ok: true, demo: false });
  publishJob.mockResolvedValue({ ok: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function goToStep(target: number): Promise<void> {
  for (let s = 1; s < target; s += 1) {
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(s));
  }
  await screen.findByRole("checkbox", { name: "agreePublish" });
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

    expect(await screen.findByRole("alert")).toHaveTextContent("saveError");
    expect(push).not.toHaveBeenCalled();
  });
});

describe("JobWizard: za długa pozycja listy (#364)", () => {
  it("odrzuca pozycję z komunikatem przy polu i zostawia wpis do skrócenia", async () => {
    render(<JobWizard initialJobId="job-1" initialValues={FULL_DRAFT} />);
    for (let s = 1; s < 5; s += 1) {
      fireEvent.click(screen.getByRole("button", { name: "next" }));
      await waitFor(() => expect(updateJobDraft).toHaveBeenCalledTimes(s));
    }
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
