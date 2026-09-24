import { describe, expect, it } from "vitest";

import { buildJobDetailPassportFields } from "@/lib/job-detail-passport";
import type { JobDetail } from "@/lib/jobs";

const baseJob: Pick<
  JobDetail,
  "city" | "region" | "contractType" | "currency" | "workingHours" | "shifts"
> = {
  city: "Antwerp",
  region: "Flanders",
  contractType: "interim",
  currency: "EUR",
  workingHours: "Full time",
  shifts: "Early and late shifts",
};

const labels = {
  location: "Location",
  salary: "Salary",
  conditions: "Conditions",
  contract: () => "Interim",
  salaryFrom: (value: string) => `from ${value}`,
  salaryTo: (value: string) => `up to ${value}`,
  salaryPeriod: (period: "hour" | "month" | "year") => `gross / ${period}`,
};

function salaryField(
  salary: Pick<JobDetail, "salaryMin" | "salaryMax" | "salaryPeriod">,
) {
  return buildJobDetailPassportFields(
    { ...baseJob, ...salary },
    "en",
    labels,
  ).find((field) => field.key === "salary");
}

describe("model paszportu szczegółu oferty", () => {
  it("pomija całe pole wynagrodzenia, gdy nie ma żadnej realnej kwoty", () => {
    const fields = buildJobDetailPassportFields(
      { ...baseJob, salaryPeriod: "month" },
      "en",
      labels,
    );

    expect(fields.map((field) => field.key)).toEqual([
      "location",
      "conditions",
    ]);
    expect(fields.map((field) => field.label)).not.toContain("Salary");
  });

  it.each([
    [
      { salaryMin: 18.75, salaryPeriod: "hour" as const },
      "from €18.75 gross / hour",
    ],
    [
      { salaryMax: 22.5, salaryPeriod: "month" as const },
      "up to €22.50 gross / month",
    ],
    [
      { salaryMin: 18.75, salaryMax: 22.5, salaryPeriod: "year" as const },
      "€18.75 – €22.50 gross / year",
    ],
  ])(
    "buduje pole z granicami i okresem wyłącznie z podanych danych: %j",
    (salary, expected) => {
      expect(salaryField(salary)).toEqual({
        key: "salary",
        label: "Salary",
        primary: expected,
      });
    },
  );

  it("nie dopisuje domyślnego okresu do starszej oferty, która go nie ma", () => {
    expect(salaryField({ salaryMin: 18.75, salaryMax: 22.5 })).toEqual({
      key: "salary",
      label: "Salary",
      primary: "€18.75 – €22.50",
    });
  });

  it("zachowuje lokalizację, region i rzeczywiste warunki pracy", () => {
    expect(buildJobDetailPassportFields(baseJob, "en", labels)).toEqual([
      {
        key: "location",
        label: "Location",
        primary: "Antwerp",
        secondary: "Flanders",
      },
      {
        key: "conditions",
        label: "Conditions",
        primary: "Interim",
        secondary: "Full time · Early and late shifts",
      },
    ]);
  });
});
