import type { ContractType, SalaryPeriod } from "@/lib/jobs";
import { formatSalaryRange } from "@/lib/salary";

export type JobDetailPassportField = {
  key: "location" | "salary" | "conditions";
  label: string;
  primary: string;
  secondary?: string;
};

type PassportJob = {
  city: string;
  region: string;
  contractType: ContractType;
  salaryMin?: number;
  salaryMax?: number;
  currency: string;
  salaryPeriod?: SalaryPeriod;
  workingHours: string;
  shifts?: string;
};

type PassportLabels = {
  location: string;
  salary: string;
  conditions: string;
  contract: (type: ContractType) => string;
  salaryFrom: (value: string) => string;
  salaryTo: (value: string) => string;
  salaryPeriod: (period: SalaryPeriod) => string;
};

/** Czysty model pól nagłówka; nie dodaje zastępczej stawki, gdy nie ma realnej kwoty. */
export function buildJobDetailPassportFields(
  job: PassportJob,
  locale: string,
  labels: PassportLabels,
): JobDetailPassportField[] {
  const salary = formatSalaryRange(job, locale, {
    from: labels.salaryFrom,
    to: labels.salaryTo,
    period: labels.salaryPeriod,
  });
  const showRegion = job.region.length > 0 && job.region !== job.city;
  const schedule = [job.workingHours, job.shifts].filter(Boolean).join(" · ");

  return [
    {
      key: "location",
      label: labels.location,
      primary: job.city,
      ...(showRegion ? { secondary: job.region } : {}),
    },
    ...(salary === null
      ? []
      : [{ key: "salary" as const, label: labels.salary, primary: salary }]),
    {
      key: "conditions",
      label: labels.conditions,
      primary: labels.contract(job.contractType),
      ...(schedule ? { secondary: schedule } : {}),
    },
  ];
}
