import { describe, expect, it } from "vitest";

import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import nl from "@/messages/nl.json";
import { routing } from "@/i18n/routing";
import { getAllGuideSlugs, getGuideBySlug } from "@/lib/guides/guides";

/**
 * Strażnik terminologii tłumaczeń (#321, #326, #329). Pilnuje wybranych decyzji
 * językowych, żeby kolejne zmiany w plikach komunikatów ich po cichu nie cofnęły.
 */

type Messages = { [key: string]: string | Messages };

function flatten(obj: Messages, prefix = ""): Array<[string, string]> {
  return Object.entries(obj).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return typeof value === "string" ? [[path, value]] : flatten(value, path);
  });
}

function get(obj: Messages, path: string): string {
  const value = path
    .split(".")
    .reduce<string | Messages | undefined>(
      (node, key) => (typeof node === "object" ? node[key] : undefined),
      obj,
    );
  if (typeof value !== "string") throw new Error(`brak klucza ${path}`);
  return value;
}

const NL = flatten(nl as Messages);
const FR = flatten(fr as Messages);

describe("NL: jeden rejestr (je/jouw)", () => {
  it("żaden komunikat nie zwraca się formą u/uw", () => {
    // Wyjątek: skrót jednostki „u” (uur), np. „38 u/week”.
    const formal = NL.filter(([, value]) =>
      /(^|[^\p{L}])(u|uw|U|Uw)(?![\p{L}/])/u.test(value),
    );
    expect(formal).toEqual([]);
  });

  it("kandydaatprofiel, nie kandidatenprofiel", () => {
    expect(NL.filter(([, v]) => /kandidatenprofiel/i.test(v))).toEqual([]);
  });

  it("landingi i nawigacja mówią „vacatures”, nie „jobs”", () => {
    for (const key of [
      "landing.availableJobs",
      "landing.viewAllJobs",
      "landing.seeAllCategory",
      "landing.seeAllCity",
      "landing.empty",
      "home.faqA2",
    ]) {
      expect(get(nl as Messages, key), key).not.toMatch(/\bjobs?\b/i);
    }
  });

  it("tytuły landingów mają poprawny szyk", () => {
    expect(get(nl as Messages, "landing.cityMetaTitle")).toMatch(/^Vacatures in \{name\}/);
    expect(get(nl as Messages, "landing.categoryMetaTitle")).toMatch(
      /^Vacatures in de sector \{name\}/,
    );
  });

  it("praca zdalna ma jedną nazwę w filtrze i kreatorze", () => {
    expect(get(nl as Messages, "jobs.remote")).toBe(get(nl as Messages, "jobWizard.remote"));
  });
});

describe("FR: terminologia", () => {
  it("praca zmianowa nie jest nazwana samym „Équipes”", () => {
    for (const key of ["job.shifts", "jobWizard.shiftsLabel"]) {
      expect(get(fr as Messages, key), key).not.toMatch(/^[ÉE]quipes$/);
    }
  });

  it("lokalizacja ma jedną nazwę: „Lieu”", () => {
    expect(FR.filter(([, v]) => /localisation|localité/i.test(v))).toEqual([]);
  });

  it("dopasowanie to „compatibilité”, nie kalka „correspondance”", () => {
    expect(FR.filter(([, v]) => /correspondance/i.test(v))).toEqual([]);
  });

  it("krótkie etykiety umów (CDI/CDD)", () => {
    expect(get(fr as Messages, "contractTypes.permanent")).toBe("CDI");
    expect(get(fr as Messages, "contractTypes.temporary")).toBe("CDD");
  });

  it("praca zdalna ma jedną nazwę w filtrze i kreatorze", () => {
    expect(get(fr as Messages, "jobs.remote")).toBe(get(fr as Messages, "jobWizard.remote"));
  });
});

describe("EN: logowanie jednym czasownikiem", () => {
  it("„Log in”, nie „Sign in”", () => {
    expect(flatten(en as Messages).filter(([, v]) => /\bsign in\b/i.test(v))).toEqual([]);
  });
});

describe("poradniki: te same zastrzeżenia we wszystkich językach (#321)", () => {
  const disclaimer: Record<string, RegExp> = {
    pl: /charakter (ogólny|informacyjny)|ogólne wprowadzenie/,
    nl: /algemene informatie/,
    fr: /informations générales/,
    en: /general information/,
  };

  it("każdy poradnik w każdym języku ma akapit zastrzeżenia", () => {
    for (const slug of getAllGuideSlugs()) {
      for (const locale of routing.locales) {
        const body = getGuideBySlug(slug, locale)!.body;
        const hasDisclaimer = body.some(
          (block) => block.type === "paragraph" && disclaimer[locale]!.test(block.text),
        );
        expect(hasDisclaimer, `${slug}/${locale}`).toBe(true);
      }
    }
  });

  it("poradnik NISS: numer BIS i bez obietnicy „bez niego nie pracujesz”", () => {
    for (const locale of routing.locales) {
      const guide = getGuideBySlug("numer-niss-i-podatki", locale)!;
      const text = [guide.excerpt, ...guide.body.flatMap((b) => (b.type === "list" ? b.items : [b.text]))].join(" ");
      expect(text, locale).toMatch(/\bBIS\b/);
      expect(text, locale).not.toMatch(
        /nie zaczniesz legalnie|niet legaal werken|impossible de travailler légalement|cannot work legally/,
      );
    }
    const nlGuide = getGuideBySlug("numer-niss-i-podatki", "nl")!;
    expect(nlGuide.title).toMatch(/INSZ/);
    expect(JSON.stringify(nlGuide)).not.toMatch(/NISS/);
  });

  it("interim: premia końcoworoczna z warunkiem stażu", () => {
    const condition: Record<string, RegExp> = {
      pl: /stażu/,
      nl: /anciënniteit/,
      fr: /ancienneté/,
      en: /worked long enough/,
    };
    for (const locale of routing.locales) {
      const items = getGuideBySlug("umowa-interim-co-warto-wiedziec", locale)!.body.flatMap((b) =>
        b.type === "list" ? b.items : [],
      );
      const bonus = items.find((item) => /premii końcoworocznej|eindejaarspremie|fin d’année|end-of-year/.test(item));
      expect(bonus, locale).toMatch(condition[locale]!);
    }
  });
});
