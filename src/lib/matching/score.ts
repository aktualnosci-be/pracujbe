/**
 * Deterministyczny silnik dopasowania kandydat <-> oferta.
 *
 * Wagi (suma = 100):
 *   zawód+kategoria 20 (zawód 12 + kategoria 8), umiejętności 20, lokalizacja 15,
 *   doświadczenie 10, dostępność 10, język 10, certyfikaty 5, transport/prawo jazdy 5, umowa 5.
 *
 * summaryKey: >=70 'good', >=40 'partial', w przeciwnym razie 'low'.
 *
 * matched / missing / strengths zawierają czytelne stringi:
 *   - dla list konkretnych (umiejętności, języki, certyfikaty, zawód, kategoria, typ umowy)
 *     zwracamy oryginalne etykiety,
 *   - dla warunków wymiarowych (lokalizacja, doświadczenie, dostępność, prawo jazdy) klucze.
 *
 * Silnik jest czysty i deterministyczny: te same wejścia => ten sam wynik. Brak I/O, brak losowości.
 */

export type MatchResult = {
  score: number;
  matched: string[];
  missing: string[];
  strengths: string[];
  mandatoryMet: number;
  mandatoryTotal: number;
  summaryKey: 'good' | 'partial' | 'low';
};

export type MatchCandidate = {
  occupations: string[];
  categories: string[];
  skills: string[];
  city?: string;
  region?: string;
  radiusKm?: number;
  experienceYears?: number;
  availability?: string;
  languages: string[];
  certificates: string[];
  hasDrivingLicense?: boolean;
  hasCar?: boolean;
  preferredContractTypes: string[];
};

export type MatchJob = {
  occupation?: string;
  category?: string;
  skills: string[];
  mandatorySkills?: string[];
  city?: string;
  region?: string;
  minExperienceYears?: number;
  requiredLanguages: string[];
  requiredCertificates?: string[];
  requiresDrivingLicense?: boolean;
  contractType?: string;
  startImmediately?: boolean;
};

const WEIGHTS = {
  occupation: 12,
  category: 8,
  skills: 20,
  location: 15,
  experience: 10,
  availability: 10,
  language: 10,
  certificates: 5,
  transport: 5,
  contract: 5,
} as const;

function norm(value: string): string {
  return value.trim().toLowerCase();
}

function overlap(
  candidate: readonly string[],
  required: readonly string[],
): { matched: string[]; missing: string[] } {
  const have = new Set(candidate.map(norm));
  const matched: string[] = [];
  const missing: string[] = [];
  for (const item of required) {
    if (have.has(norm(item))) {
      matched.push(item);
    } else {
      missing.push(item);
    }
  }
  return { matched, missing };
}

function dedupe(values: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      out.push(value);
    }
  }
  return out;
}

export function scoreMatch(candidate: MatchCandidate, job: MatchJob): MatchResult {
  const matched: string[] = [];
  const missing: string[] = [];
  const strengths: string[] = [];
  let score = 0;

  // --- Zawód + kategoria (20) ---
  if (job.occupation) {
    if (candidate.occupations.map(norm).includes(norm(job.occupation))) {
      score += WEIGHTS.occupation;
      matched.push(job.occupation);
    } else {
      missing.push(job.occupation);
    }
  } else {
    score += WEIGHTS.occupation;
  }

  if (job.category) {
    if (candidate.categories.map(norm).includes(norm(job.category))) {
      score += WEIGHTS.category;
      matched.push(job.category);
    } else {
      missing.push(job.category);
    }
  } else {
    score += WEIGHTS.category;
  }

  // --- Umiejętności (20) ---
  if (job.skills.length === 0) {
    score += WEIGHTS.skills;
  } else {
    const result = overlap(candidate.skills, job.skills);
    score += Math.round((result.matched.length / job.skills.length) * WEIGHTS.skills);
    matched.push(...result.matched);
    missing.push(...result.missing);
  }

  // --- Umiejętności obowiązkowe (informacyjnie: mandatoryMet / mandatoryTotal) ---
  const mandatory = job.mandatorySkills ?? [];
  const mandatoryTotal = mandatory.length;
  const candidateSkills = new Set(candidate.skills.map(norm));
  let mandatoryMet = 0;
  for (const skill of mandatory) {
    if (candidateSkills.has(norm(skill))) {
      mandatoryMet += 1;
    } else {
      missing.push(skill);
    }
  }
  if (mandatoryTotal > 0 && mandatoryMet === mandatoryTotal) {
    strengths.push('allMandatorySkills');
  }

  // --- Lokalizacja (15) ---
  if (!job.city && !job.region) {
    score += WEIGHTS.location;
  } else {
    const cityMatch =
      !!job.city && !!candidate.city && norm(candidate.city) === norm(job.city);
    const regionMatch =
      !!job.region && !!candidate.region && norm(candidate.region) === norm(job.region);
    if (cityMatch) {
      score += WEIGHTS.location;
      strengths.push('localCandidate');
    } else if (regionMatch) {
      score += 10;
    } else {
      missing.push('location');
    }
  }

  // --- Doświadczenie (10) ---
  const minExp = job.minExperienceYears;
  if (minExp == null || minExp <= 0) {
    score += WEIGHTS.experience;
  } else if (candidate.experienceYears == null) {
    missing.push('experience');
  } else if (candidate.experienceYears >= minExp) {
    score += WEIGHTS.experience;
    if (candidate.experienceYears >= minExp + 2) {
      strengths.push('experienceExceeds');
    }
  } else {
    const partial = Math.round((candidate.experienceYears / minExp) * WEIGHTS.experience);
    score += partial;
    if (partial === 0) {
      missing.push('experience');
    }
  }

  // --- Dostępność (10) ---
  if (!job.startImmediately) {
    score += WEIGHTS.availability;
  } else if (candidate.availability && norm(candidate.availability) === 'immediate') {
    score += WEIGHTS.availability;
    strengths.push('immediateStart');
  } else if (candidate.availability) {
    score += 5;
  } else {
    missing.push('availability');
  }

  // --- Język (10) ---
  if (job.requiredLanguages.length === 0) {
    score += WEIGHTS.language;
    strengths.push('noLanguageBarrier');
  } else {
    const result = overlap(candidate.languages, job.requiredLanguages);
    score += Math.round((result.matched.length / job.requiredLanguages.length) * WEIGHTS.language);
    matched.push(...result.matched);
    missing.push(...result.missing);
  }

  // --- Certyfikaty (5) ---
  const requiredCertificates = job.requiredCertificates ?? [];
  if (requiredCertificates.length === 0) {
    score += WEIGHTS.certificates;
  } else {
    const result = overlap(candidate.certificates, requiredCertificates);
    score += Math.round(
      (result.matched.length / requiredCertificates.length) * WEIGHTS.certificates,
    );
    matched.push(...result.matched);
    missing.push(...result.missing);
  }

  // --- Transport / prawo jazdy (5) ---
  if (!job.requiresDrivingLicense) {
    score += WEIGHTS.transport;
    if (candidate.hasCar) {
      strengths.push('ownTransport');
    }
  } else if (candidate.hasDrivingLicense) {
    score += WEIGHTS.transport;
    if (candidate.hasCar) {
      strengths.push('ownTransport');
    }
  } else {
    missing.push('drivingLicense');
  }

  // --- Typ umowy (5) ---
  if (!job.contractType) {
    score += WEIGHTS.contract;
  } else if (candidate.preferredContractTypes.length === 0) {
    // Brak preferencji => kandydat elastyczny.
    score += WEIGHTS.contract;
  } else if (candidate.preferredContractTypes.map(norm).includes(norm(job.contractType))) {
    score += WEIGHTS.contract;
    matched.push(job.contractType);
  } else {
    missing.push('contractType');
  }

  const finalScore = Math.max(0, Math.min(100, Math.round(score)));
  const summaryKey: MatchResult['summaryKey'] =
    finalScore >= 70 ? 'good' : finalScore >= 40 ? 'partial' : 'low';

  return {
    score: finalScore,
    matched: dedupe(matched),
    missing: dedupe(missing),
    strengths: dedupe(strengths),
    mandatoryMet,
    mandatoryTotal,
    summaryKey,
  };
}
