import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobWizard } from "@/components/employer/JobWizard";
import { OnboardingWizard } from "@/components/candidate/OnboardingWizard";
import { CANDIDATE_ITEM_LIMITS } from "@/lib/validation/candidate";

const { createJobDraft, updateJobDraft, publishJob, saveOnboardingStep, push } = vi.hoisted(
  () => ({
    createJobDraft: vi.fn(),
    updateJobDraft: vi.fn(),
    publishJob: vi.fn(),
    saveOnboardingStep: vi.fn(),
    push: vi.fn(),
  }),
);

vi.mock("@/lib/actions/jobs", () => ({ createJobDraft, updateJobDraft, publishJob }));
vi.mock("@/lib/actions/onboarding", () => ({ saveOnboardingStep }));
vi.mock("@/i18n/navigation", () => ({
  useRouter: () => ({ push }),
  Link: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("next-intl", () => {
  const t = Object.assign(
    (key: string, values?: Record<string, unknown>) =>
      values ? `${key}:${JSON.stringify(values)}` : key,
    { rich: (key: string) => key },
  );
  return { useTranslations: () => t, useLocale: () => "pl" };
});

const step1Job = {
  title: "Operator wózka widłowego",
  category: "warehouse",
  occupation: "Magazynier",
};

beforeEach(() => {
  Element.prototype.scrollIntoView = vi.fn();
  // Radix Checkbox (krok 2 kreatora) mierzy się przez ResizeObserver, którego jsdom nie ma.
  globalThis.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  createJobDraft.mockResolvedValue({ ok: true, id: "draft-1", demo: true });
  updateJobDraft.mockResolvedValue({ ok: true, demo: true });
  saveOnboardingStep.mockResolvedValue({ ok: true, demo: true });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("JobWizard: fokus i ogłoszenie kroku (#402)", () => {
  it("po „Dalej” fokus trafia na nagłówek nowego kroku, a krok jest ogłaszany", async () => {
    render(<JobWizard initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    const heading = await screen.findByRole("heading", { level: 2, name: "step2Title" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(heading).toHaveAttribute("tabindex", "-1");
    expect(
      screen.getByText('stepAnnounce:{"current":2,"total":9,"title":"step2Title"}'),
    ).toHaveAttribute("aria-live", "polite");
  });

  it("po „Wstecz” fokus wraca na nagłówek poprzedniego kroku", async () => {
    render(<JobWizard initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByRole("heading", { level: 2, name: "step2Title" });

    fireEvent.click(screen.getByRole("button", { name: "back" }));
    const heading = await screen.findByRole("heading", { level: 2, name: "step1Title" });
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("stan zapisu ogłasza dokładnie jeden region statusu", async () => {
    render(<JobWizard initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));
    await screen.findByRole("heading", { level: 2, name: "step2Title" });

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.getByRole("status")).toHaveTextContent("savedDemo");
  });

  it("pierwszy render nie przenosi fokusu na nagłówek", () => {
    render(<JobWizard initialValues={step1Job} />);
    expect(screen.getByRole("heading", { level: 2, name: "step1Title" })).not.toHaveFocus();
  });
});

describe("JobWizard: kod błędu serwera w komunikacie (#363)", () => {
  it("JOB_NOT_DRAFT → komunikat errors.jobNotDraft i link do listy ofert, bez przejścia dalej", async () => {
    updateJobDraft.mockResolvedValue({ ok: false, error: "JOB_NOT_DRAFT" });
    render(<JobWizard initialJobId="job-1" initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.jobNotDraft");
    expect(screen.getByRole("link", { name: "goToOffers" })).toHaveAttribute(
      "href",
      "/employer/oferty",
    );
    expect(screen.getByRole("heading", { level: 2, name: "step1Title" })).toBeInTheDocument();
  });

  it.each([
    ["RATE_LIMITED", "errors.rateLimited"],
    ["PERMISSION_DENIED", "errors.permissionDenied"],
    ["VALIDATION_FAILED", "errors.validationFailed"],
    ["NOT_FOUND", "errors.notFound"],
  ])("%s z updateJobDraft → %s (bez linku do listy)", async (code, key) => {
    updateJobDraft.mockResolvedValue({ ok: false, error: code });
    render(<JobWizard initialJobId="job-1" initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(key);
    expect(screen.getByRole("alert")).not.toHaveTextContent("saveError");
    expect(screen.queryByRole("link", { name: "goToOffers" })).toBeNull();
  });

  it("kod z createJobDraft też trafia do komunikatu", async () => {
    createJobDraft.mockResolvedValue({ ok: false, error: "RATE_LIMITED" });
    render(<JobWizard initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.rateLimited");
    expect(updateJobDraft).not.toHaveBeenCalled();
  });

  it("wyjątek (np. zerwane połączenie) → komunikat INTERNAL", async () => {
    updateJobDraft.mockRejectedValue(new Error("network"));
    render(<JobWizard initialJobId="job-1" initialValues={step1Job} />);
    fireEvent.click(screen.getByRole("button", { name: "next" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.internal");
  });
});

const onboardingValues = {
  firstName: "Anna",
  lastName: "Nowak",
  occupations: [],
  categories: [],
  city: "Antwerpen",
  availability: "immediate" as const,
};

describe("OnboardingWizard: kod błędu serwera (#363)", () => {
  it("ONBOARDING_INCOMPLETE przy „Zakończ” → komunikat i przejście do brakującego kroku", async () => {
    saveOnboardingStep.mockResolvedValue({ ok: false, error: "ONBOARDING_INCOMPLETE" });
    render(<OnboardingWizard initialStep={6} initialValues={onboardingValues} />);
    fireEvent.click(screen.getByRole("checkbox", { name: "agreeTermsLinks" }));
    fireEvent.click(screen.getByRole("button", { name: "finish" }));

    const heading = await screen.findByRole("heading", { level: 2, name: "step2Title" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(screen.getByRole("alert")).toHaveTextContent("errors.onboardingIncomplete");
    expect(saveOnboardingStep).toHaveBeenCalledWith(6, expect.anything(), { finish: true });
    expect(push).not.toHaveBeenCalled();
  });

  it("RATE_LIMITED → własny komunikat, krok bez zmian", async () => {
    saveOnboardingStep.mockResolvedValue({ ok: false, error: "RATE_LIMITED" });
    render(<OnboardingWizard initialValues={onboardingValues} />);
    fireEvent.click(screen.getByRole("button", { name: /^next/ }));

    expect(await screen.findByRole("alert")).toHaveTextContent("errors.rateLimited");
    expect(screen.getByRole("heading", { level: 2, name: "step1Title" })).toBeInTheDocument();
  });

  it("puste imię → „wymagane”, nie „za krótkie” (#367)", async () => {
    render(<OnboardingWizard initialValues={{ ...onboardingValues, firstName: "" }} />);
    fireEvent.click(screen.getByRole("button", { name: /^next/ }));

    expect(await screen.findByText("candidate.error.firstNameRequired")).toBeInTheDocument();
    expect(screen.queryByText("candidate.error.firstNameTooShort")).toBeNull();
    expect(saveOnboardingStep).not.toHaveBeenCalled();
  });
});

describe("OnboardingWizard: za długa pozycja listy (#364)", () => {
  it("zawód dłuższy niż limit nie trafia na listę i ma komunikat przy polu", () => {
    render(<OnboardingWizard initialStep={2} initialValues={onboardingValues} />);
    const input = screen.getByLabelText("occupationsLabel");
    const max = CANDIDATE_ITEM_LIMITS.occupation;

    fireEvent.change(input, { target: { value: "a".repeat(max + 1) } });
    fireEvent.click(screen.getByRole("button", { name: "add" }));

    expect(
      screen.getByText(`itemTooLongMax:${JSON.stringify({ max })}`),
    ).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveValue("a".repeat(max + 1));
    expect(screen.queryByRole("button", { name: /^remove:/ })).toBeNull();

    fireEvent.change(input, { target: { value: "a".repeat(max) } });
    fireEvent.click(screen.getByRole("button", { name: "add" }));
    expect(screen.getByRole("button", { name: `remove: ${"a".repeat(max)}` })).toBeInTheDocument();
    expect(input).not.toHaveAttribute("aria-invalid");
  });
});

describe("OnboardingWizard: data ważności certyfikatu (#96)", () => {
  it("wygasły certyfikat oznaczony, poprawiona data zapisuje się razem z krokiem 5", async () => {
    render(
      <OnboardingWizard
        initialStep={5}
        initialValues={{
          ...onboardingValues,
          certificates: ["VCA", "ADR"],
          certificateExpiry: { VCA: "2000-01-01" },
        }}
      />,
    );
    const vca = screen.getByLabelText(`certificateExpiryLabel:${JSON.stringify({ certificate: "VCA" })}`);
    expect(vca).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByText("certificateExpired")).toHaveLength(1);

    fireEvent.change(vca, { target: { value: "2999-12-31" } });
    expect(screen.queryByText("certificateExpired")).toBeNull();
    expect(vca).not.toHaveAttribute("aria-invalid");

    fireEvent.click(screen.getByRole("button", { name: /^next/ }));
    await waitFor(() =>
      expect(saveOnboardingStep).toHaveBeenCalledWith(
        5,
        expect.objectContaining({
          certificates: ["VCA", "ADR"],
          certificateExpiry: { VCA: "2999-12-31" },
        }),
        expect.anything(),
      ),
    );
  });
});
