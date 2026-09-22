import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Stepper } from "@/components/ui/stepper";
import pl from "@/messages/pl.json";
import nl from "@/messages/nl.json";
import fr from "@/messages/fr.json";
import en from "@/messages/en.json";

const steps = [
  { title: "Stanowisko", desc: "Tytuł i zawód" },
  { title: "Umowa i grafik" },
  { title: "Lokalizacja" },
];

describe("Stepper kreatorów", () => {
  it("ogłasza bieżący krok i zachowuje pełną kolejność dla czytnika ekranu", () => {
    render(<Stepper steps={steps} current={1} progressLabel="Krok 2 z 3" />);

    const navigation = screen.getByRole("navigation", { name: "Krok 2 z 3" });
    const items = within(navigation).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    expect(items[1]).toHaveAttribute("aria-current", "step");
    expect(items[0]).not.toHaveAttribute("aria-current");
    expect(items[2]).not.toHaveAttribute("aria-current");
    expect(items.map((item) => item.textContent)).toEqual([
      "1. Stanowisko",
      "2. Umowa i grafik",
      "3. Lokalizacja",
    ]);
    expect(within(navigation).getByText("Umowa i grafik")).toBeVisible();
  });

  it.each([pl, nl, fr, en])(
    "ma lokalizowany tekst postępu w obu kreatorach",
    (messages) => {
      for (const section of [messages.onboarding, messages.jobWizard]) {
        expect(section.stepProgress).toContain("{current}");
        expect(section.stepProgress).toContain("{total}");
      }
    },
  );
});
