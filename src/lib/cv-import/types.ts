import type { LANGUAGE_LEVELS } from '@/lib/validation/candidate';

/**
 * Typy propozycji importu CV (#487) — współdzielone przez serwer i UI (bez `server-only`).
 * Propozycja to NIE jest zapis: do profilu trafia wyłącznie to, co kandydat zatwierdzi
 * (`applyCvProposals` → RPC `apply_candidate_cv_proposals`, 0102).
 */

export type CvProposalKind = 'occupation' | 'skill' | 'language' | 'certificate' | 'experienceYears';

export type LanguageLevel = (typeof LANGUAGE_LEVELS)[number];

export interface CvProposal {
  /** Stabilny identyfikator w obrębie jednego wyniku (`skill-0`…). */
  id: string;
  kind: CvProposalKind;
  /** Wartość pola (dla doświadczenia — liczba lat jako tekst). */
  value: string;
  /** Tylko `language`: poziom zaproponowany przez model (albo `basic` przy niepewności). */
  level?: LanguageLevel;
  /** Krótki cytat ze ZREDAGOWANEGO tekstu CV, z którego pochodzi propozycja; pusty = brak źródła. */
  evidence: string;
  /** Model wskazał niepewność albo źródła nie ma w tekście — kandydat musi to szczególnie sprawdzić. */
  uncertain: boolean;
}

/** Liczniki redakcji pokazywane kandydatowi (bez wartości). */
export interface CvRedactionSummary {
  referenceSections: number;
  personalSections: number;
  thirdPartyLines: number;
  personalLines: number;
  specialCategoryLines: number;
  contacts: number;
}

/** Zatwierdzone przez kandydata pozycje (wejście akcji zapisu). */
export interface CvApprovedProposals {
  occupations: string[];
  skills: string[];
  languages: { language: string; level: LanguageLevel }[];
  certificates: string[];
  experienceYears: number | null;
}
