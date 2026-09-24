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
 * Język (#195): każdy wymagany język waży 10/n pkt. Poziom deklarowany ≥ wymagany (albo oferta
 * nie podaje poziomu) → pełny udział; o jeden poziom niżej → połowa; o dwa i więcej → 0; poziom
 * kandydata nieznany przy wymaganym poziomie → 0 (konserwatywnie). Niespełniony poziom trafia do
 * `languageGaps` (nie do `matched`).
 *
 * Lokalizacja (#194): gdy znamy współrzędne obu miejscowości (słownik `locations`), odległość
 * po wielkim kole porównujemy z promieniem kandydata — w promieniu 15 pkt niezależnie od granicy
 * regionu, poza nim 0. Bez współrzędnych nie udajemy odległości: to samo miasto 15, ten sam
 * region 10 (bez etykiety „w promieniu"), inaczej 0.
 *
 * Certyfikaty (#96): certyfikat kandydata z `expiresAt` wcześniejszym niż data odniesienia
 * (`options.today`, 'YYYY-MM-DD') nie spełnia wymagania — ważny jest jeszcze w dniu wygaśnięcia.
 * Brak `expiresAt` = certyfikat bezterminowy (jak dotąd). Wymagany, a wygasły certyfikat trafia
 * do `expiredCertificates` (nie do `matched` ani `missing`).
 *
 * Silnik jest czysty i deterministyczny: te same wejścia (łącznie z `options.today`) => ten sam
 * wynik. Brak I/O, brak losowości; bez `options.today` datą odniesienia jest bieżąca data UTC.
 */

export const LANGUAGE_LEVEL_ORDER = ['basic', 'intermediate', 'fluent', 'native'] as const;
export type LanguageLevel = (typeof LANGUAGE_LEVEL_ORDER)[number];

/**
 * Język z poziomem. Sam string = sama etykieta: po stronie oferty „poziom dowolny",
 * po stronie kandydata „poziom nieznany".
 */
export type LanguageEntry = string | { label: string; level?: string | null };

export type LanguageGap = {
  language: string;
  required: LanguageLevel;
  /** null = kandydat zna język, ale poziom nieznany. */
  actual: LanguageLevel | null;
};

/**
 * Certyfikat kandydata. Sam string = certyfikat bez daty ważności (bezterminowy).
 * `expiresAt` w formacie 'YYYY-MM-DD'.
 */
export type CertificateEntry = string | { label: string; expiresAt?: string | null };

export type MatchOptions = {
  /** Data odniesienia 'YYYY-MM-DD' dla ważności certyfikatów (domyślnie bieżąca data UTC). */
  today?: string;
};

export type Coordinates = { lat: number; lng: number };

export type MatchResult = {
  score: number;
  matched: string[];
  missing: string[];
  strengths: string[];
  mandatoryMet: number;
  mandatoryTotal: number;
  summaryKey: 'good' | 'partial' | 'low';
  /** Wymagane języki, które kandydat zna, ale poniżej wymaganego poziomu (#195). */
  languageGaps: LanguageGap[];
  /** Wymagane certyfikaty, które kandydat ma, ale z upływem ważności (#96). */
  expiredCertificates: string[];
};

export type MatchCandidate = {
  occupations: string[];
  categories: string[];
  skills: string[];
  city?: string;
  region?: string;
  radiusKm?: number;
  /** Współrzędne miejscowości kandydata ze słownika (brak = nieznane, bez szacowania). */
  coordinates?: Coordinates;
  experienceYears?: number;
  availability?: string;
  languages: LanguageEntry[];
  certificates: CertificateEntry[];
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
  /** Współrzędne miejsca pracy ze słownika (brak = nieznane). */
  coordinates?: Coordinates;
  minExperienceYears?: number;
  requiredLanguages: LanguageEntry[];
  requiredCertificates?: string[];
  requiresDrivingLicense?: boolean;
  contractType?: string;
  startImmediately?: boolean;
  /** Praca zdalna — znosi ograniczenie lokalizacji (pełne punkty). */
  remote?: boolean;
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

function toLevel(value: string | null | undefined): LanguageLevel | null {
  if (!value) return null;
  const v = norm(value);
  return (LANGUAGE_LEVEL_ORDER as readonly string[]).includes(v) ? (v as LanguageLevel) : null;
}

function entryLabel(entry: LanguageEntry): string {
  return typeof entry === 'string' ? entry : entry.label;
}

function entryLevel(entry: LanguageEntry): LanguageLevel | null {
  return typeof entry === 'string' ? null : toLevel(entry.level);
}

/**
 * Udział (0..1) jednego wymaganego języka według jawnej reguły poziomów (#195).
 * `null` od kandydata = brak języka.
 */
export function languageShare(
  required: LanguageLevel | null,
  actual: LanguageLevel | null | undefined,
): number {
  if (actual === undefined) return 0;
  if (required === null) return 1;
  if (actual === null) return 0;
  const diff = LANGUAGE_LEVEL_ORDER.indexOf(required) - LANGUAGE_LEVEL_ORDER.indexOf(actual);
  if (diff <= 0) return 1;
  return diff === 1 ? 0.5 : 0;
}

const EARTH_RADIUS_KM = 6371;

/** Odległość po wielkim kole (haversine) w km — deterministyczna, bez usług zewnętrznych. */
export function distanceKm(a: Coordinates, b: Coordinates): number {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Bieżąca data UTC 'YYYY-MM-DD' (domyślna data odniesienia ważności certyfikatów). */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Czy certyfikat jest ważny w dniu `today` (#96). Daty 'YYYY-MM-DD' porównujemy leksykalnie —
 * format ISO zachowuje kolejność. Wygasa dopiero dzień PO `expiresAt`; brak daty = bezterminowy.
 */
export function isCertificateValid(entry: CertificateEntry, today: string): boolean {
  if (typeof entry === 'string') return true;
  const expiresAt = entry.expiresAt?.slice(0, 10);
  return !expiresAt || expiresAt >= today;
}

function certificateLabel(entry: CertificateEntry): string {
  return typeof entry === 'string' ? entry : entry.label;
}

export function scoreMatch(
  candidate: MatchCandidate,
  job: MatchJob,
  options: MatchOptions = {},
): MatchResult {
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

  // --- Lokalizacja (15) — remote znosi ograniczenie; odległość tylko ze znanych współrzędnych ---
  if (job.remote) {
    score += WEIGHTS.location;
    strengths.push('remoteJob');
  } else if (!job.city && !job.region) {
    score += WEIGHTS.location;
  } else {
    const cityMatch =
      !!job.city && !!candidate.city && norm(candidate.city) === norm(job.city);
    const regionMatch =
      !!job.region && !!candidate.region && norm(candidate.region) === norm(job.region);
    if (cityMatch) {
      score += WEIGHTS.location;
      strengths.push('localCandidate');
    } else if (candidate.coordinates && job.coordinates) {
      // Znana odległość: rozstrzyga promień, nie nazwa regionu (#194).
      const km = distanceKm(candidate.coordinates, job.coordinates);
      if (km <= (candidate.radiusKm ?? 0)) {
        score += WEIGHTS.location;
        strengths.push('withinCommuteRadius');
      } else {
        missing.push('location');
      }
    } else if (regionMatch) {
      // Odległość nieznana — ten sam region to tylko przesłanka, nie „w promieniu dojazdu".
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

  // --- Język (10) — każdy wymagany język osobno, z poziomem (#195) ---
  const languageGaps: LanguageGap[] = [];
  const expiredCertificates: string[] = [];
  if (job.requiredLanguages.length === 0) {
    score += WEIGHTS.language;
    strengths.push('noLanguageBarrier');
  } else {
    const candidateLevels = new Map<string, LanguageLevel | null>();
    for (const entry of candidate.languages) {
      const key = norm(entryLabel(entry));
      const level = entryLevel(entry);
      const prev = candidateLevels.get(key);
      // Duplikat etykiety: bierzemy wyższy znany poziom.
      if (
        prev === undefined ||
        (level !== null &&
          (prev === null || LANGUAGE_LEVEL_ORDER.indexOf(level) > LANGUAGE_LEVEL_ORDER.indexOf(prev)))
      ) {
        candidateLevels.set(key, level);
      }
    }
    let shares = 0;
    for (const entry of job.requiredLanguages) {
      const label = entryLabel(entry);
      const required = entryLevel(entry);
      const actual = candidateLevels.get(norm(label));
      const share = languageShare(required, actual);
      shares += share;
      if (actual === undefined) {
        missing.push(label);
      } else if (share === 1) {
        matched.push(label);
      } else if (required !== null) {
        languageGaps.push({ language: label, required, actual });
      }
    }
    score += Math.round((shares / job.requiredLanguages.length) * WEIGHTS.language);
  }

  // --- Certyfikaty (5) ---
  const requiredCertificates = job.requiredCertificates ?? [];
  if (requiredCertificates.length === 0) {
    score += WEIGHTS.certificates;
  } else {
    const today = options.today ?? todayUtc();
    const valid = candidate.certificates.filter((c) => isCertificateValid(c, today));
    const expired = new Set(
      candidate.certificates
        .filter((c) => !isCertificateValid(c, today))
        .map((c) => norm(certificateLabel(c))),
    );
    const result = overlap(valid.map(certificateLabel), requiredCertificates);
    score += Math.round(
      (result.matched.length / requiredCertificates.length) * WEIGHTS.certificates,
    );
    matched.push(...result.matched);
    for (const label of result.missing) {
      if (expired.has(norm(label))) expiredCertificates.push(label);
      else missing.push(label);
    }
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

  let finalScore = Math.max(0, Math.min(100, Math.round(score)));
  // Wymagania OBOWIĄZKOWE działają jak próg: gdy któreś nie jest spełnione, dopasowanie
  // NIE może być „good" (koniec zawyżania mimo braku kluczowych umiejętności) — FUN-06.
  if (mandatoryTotal > 0 && mandatoryMet < mandatoryTotal) {
    finalScore = Math.min(finalScore, 65);
  }
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
    languageGaps,
    expiredCertificates: dedupe(expiredCertificates),
  };
}
