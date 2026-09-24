import type {
  JobStep1,
  JobStep2,
  JobStep3,
  JobStep4,
  JobStep5,
  JobStep6,
  JobStep7,
  JobStep8,
  JobStep9Draft,
} from '@/lib/validation/job';

/** Puste/whitespace → null (kolumny nullable), w innym wypadku wartość surowa. */
function nullIfEmpty(value: string | undefined | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}

/**
 * Treść pojedynczego kroku → kształt `p_content` RPC `save_job_draft` (0083, #192). Klucze
 * nieobecne w kroku nie są zapisywane (patch); obecny klucz `translation` = upsert tłumaczenia
 * w języku oferty (tytuł zawsze z `jobs.title`). Zwraca null dla nieznanego kroku.
 */
export function buildDraftStepContent(step: number, parsed: unknown): Record<string, unknown> | null {
  switch (step) {
    case 1: {
      const v = parsed as JobStep1;
      return {
        job: { title: v.title, category: v.category, occupation: v.occupation },
        translation: {},
      };
    }
    case 2: {
      const v = parsed as JobStep2;
      return {
        job: {
          contract_type: v.contractType,
          working_hours: v.workingHours,
          shifts: nullIfEmpty(v.shifts),
          start_immediately: v.startImmediately,
          start_date: v.startDate ?? null,
        },
        translation: {},
      };
    }
    case 3: {
      const v = parsed as JobStep3;
      return {
        job: { city: v.city, region: v.region, address: nullIfEmpty(v.address), remote: v.remote },
      };
    }
    case 4: {
      const v = parsed as JobStep4;
      return {
        job: {
          salary_min: v.salaryMin ?? null,
          salary_max: v.salaryMax ?? null,
          currency: v.currency,
          salary_period: v.salaryPeriod,
        },
      };
    }
    case 5: {
      const v = parsed as JobStep5;
      return { translation: { description: v.description, responsibilities: v.responsibilities } };
    }
    case 6: {
      const v = parsed as JobStep6;
      return {
        job: { min_experience_years: v.minExperienceYears ?? null },
        requirements_mandatory: v.requirementsMandatory,
        skills_mandatory: v.mandatorySkills,
      };
    }
    case 7: {
      const v = parsed as JobStep7;
      return {
        job: {
          requires_driving_license: v.requiresDrivingLicense,
          no_language_required: v.noLanguageRequired,
        },
        requirements_optional: v.requirementsOptional,
        skills_optional: v.skills,
        languages: v.languages.map((l) => ({ language: l.language, level: l.level })),
        certificates: v.requiredCertificates,
      };
    }
    case 8: {
      const v = parsed as JobStep8;
      return {
        job: { accommodation: v.accommodation, transport: v.transport },
        translation: { conditions: v.conditions, benefits: v.benefits },
      };
    }
    case 9: {
      const v = parsed as JobStep9Draft;
      return {
        job: { contact_email: nullIfEmpty(v.contactEmail) },
        translation: { company_description: v.companyDescription },
      };
    }
    default:
      return null;
  }
}
