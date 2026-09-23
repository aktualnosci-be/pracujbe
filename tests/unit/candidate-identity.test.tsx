import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { CandidateIdentity } from "@/components/candidate/CandidateIdentity";
import type {
  CandidatePassport,
  CandidateProfileSummary,
} from "@/lib/data/candidate";
import en from "@/messages/en.json";
import fr from "@/messages/fr.json";
import nl from "@/messages/nl.json";
import pl from "@/messages/pl.json";

afterEach(cleanup);

const profile: CandidateProfileSummary = {
  loadFailed: false,
  firstName: "Maria",
  completionPct: 50,
  checklist: {
    basicInfo: true,
    experience: false,
    education: true,
    skills: true,
    languages: false,
    photo: false,
  },
};
const passport: CandidatePassport = {
  loadFailed: false,
  occupations: ["Operatorka wózka widłowego", "Pracowniczka magazynu"],
  city: "Antwerpia",
  availability: "immediate",
  radiusKm: 25,
  experienceYears: 3,
  skills: [],
  languages: [],
  certificates: [],
};

const translations = { pl, nl, fr, en } as const;
const availability = {
  pl: pl.onboarding.availImmediate,
  nl: nl.onboarding.availImmediate,
  fr: fr.onboarding.availImmediate,
  en: en.onboarding.availImmediate,
};

function labels(locale: keyof typeof translations) {
  const m = translations[locale].candidatePassport;
  return {
    eyebrow: m.identityEyebrow,
    emptyName: m.identityEmptyName,
    emptyIdentity: m.identityEmpty,
    loadError: m.loadError,
    availability: availability[locale],
  };
}

describe("paszport tożsamości kandydata", () => {
  it.each(["pl", "nl", "fr", "en"] as const)(
    "pokazuje zapisane dane w %s",
    (locale) => {
      render(
        <CandidateIdentity
          profile={profile}
          passport={passport}
          labels={labels(locale)}
        />,
      );
      const card = screen.getByTestId("candidate-identity");
      expect(
        within(card).getByRole("heading", { level: 2, name: "Maria" }),
      ).toBeInTheDocument();
      expect(card).toHaveTextContent("Operatorka wózka widłowego");
      expect(card).toHaveTextContent("Antwerpia");
      expect(card).toHaveTextContent(availability[locale]);
      expect(card).not.toHaveTextContent("Pracowniczka magazynu");
      expect(within(card).queryByRole("alert")).not.toBeInTheDocument();
    },
  );

  it.each(["pl", "nl", "fr", "en"] as const)(
    "nie wymyśla imienia ani dostępności przy pustych danych w %s",
    (locale) => {
      render(
        <CandidateIdentity
          profile={{ ...profile, firstName: null }}
          passport={{
            ...passport,
            occupations: [],
            city: null,
            availability: null,
          }}
          labels={{ ...labels(locale), availability: null }}
        />,
      );
      const card = screen.getByTestId("candidate-identity");
      expect(
        within(card).getByRole("heading", {
          level: 2,
          name: translations[locale].candidatePassport.identityEmptyName,
        }),
      ).toBeInTheDocument();
      expect(card).toHaveTextContent(
        translations[locale].candidatePassport.identityEmpty,
      );
      expect(card).not.toHaveTextContent("Maria");
      expect(card).not.toHaveTextContent(availability[locale]);
    },
  );

  it.each(["profile", "passport"] as const)(
    "ukrywa wszystkie dane po błędzie odczytu %s",
    (source) => {
      render(
        <CandidateIdentity
          profile={{ ...profile, loadFailed: source === "profile" }}
          passport={{ ...passport, loadFailed: source === "passport" }}
          labels={labels("pl")}
        />,
      );
      const card = screen.getByTestId("candidate-identity");
      expect(within(card).getByRole("alert")).toHaveTextContent(
        pl.candidatePassport.loadError,
      );
      expect(card).not.toHaveTextContent("Maria");
      expect(card).not.toHaveTextContent("Antwerpia");
      expect(card).not.toHaveTextContent(availability.pl);
    },
  );
});
