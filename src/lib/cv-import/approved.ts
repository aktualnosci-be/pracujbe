import { z } from 'zod/v3';

import { isDisallowedProposalText } from '@/lib/cv-import/minimize';
import { CV_PROPOSAL_LIMITS } from '@/lib/cv-import/proposals';
import type { CvProposalKind, LanguageLevel } from '@/lib/cv-import/types';
import { candidateLanguageSchema, step2Schema, step3Schema, step5Schema } from '@/lib/validation/candidate';

/**
 * Walidacja zatwierdzonych (i ewentualnie poprawionych przez kandydata) propozycji importu CV
 * (#487). Moduł czysty (bez `server-only`) — ten sam kod sprawdza pole w przeglądarce
 * (`proposalValueProblem`, błąd przy polu) i całe wejście akcji `applyCvProposals`
 * (`cvApprovedProposalsSchema`, wartość spoza limitu → `VALIDATION_FAILED`).
 *
 * Pozycje biorą schematy wprost z kroków kreatora onboardingu (step2/3/5Schema →
 * `CANDIDATE_ITEM_LIMITS`, `candidateLanguageSchema`, lata 0–60), więc import CV nie może
 * zapisać niczego, czego nie przyjąłby kreator; RPC 0115 sprawdza te same granice w bazie.
 * Dodatkowo: wartość z kontaktem, linkiem, osobą trzecią, kategorią szczególną albo
 * identyfikatorem jest odrzucana także po edycji (`isDisallowedProposalText`).
 *
 * Duplikaty języka (#805): RPC `apply_candidate_cv_proposals` (0115) deduplikuje języki po
 * `lower(btrim(language))` i zachowuje tylko jeden (niezdefiniowany) poziom bez ostrzeżenia,
 * jeśli kandydat zatwierdzi dwie propozycje, których nazwa po normalizacji jest identyczna, ale
 * poziom różny. `cvApprovedProposalsSchema` odrzuca takie wejście PRZED wysłaniem do bazy
 * (`VALIDATION_FAILED`), a `findDuplicateLanguageIds` pozwala UI wskazać konflikt przy polu,
 * zanim akcja w ogóle zostanie wywołana.
 */

const allowed = (v: string) => !isDisallowedProposalText(v);

/** Normalizacja nazwy języka do porównań duplikatów — jak `lower(btrim(...))` w RPC 0115. */
export function normalizeLanguageName(value: string): string {
  return value.trim().toLowerCase();
}

/** Pojedyncze pozycje — elementy schematów kroków kreatora + zakaz danych spoza profilu. */
export const cvProposalItemSchemas = {
  occupation: step2Schema.shape.occupations.element.refine(allowed),
  skill: step3Schema.shape.skills.removeDefault().element.refine(allowed),
  certificate: step5Schema.shape.certificates.removeDefault().element.refine(allowed),
  language: candidateLanguageSchema.refine((l) => allowed(l.language)),
  experienceYears: step3Schema.shape.experienceYears,
} as const;

export const cvApprovedProposalsSchema = z
  .object({
    occupations: z.array(cvProposalItemSchemas.occupation).max(CV_PROPOSAL_LIMITS.occupations).default([]),
    skills: z.array(cvProposalItemSchemas.skill).max(CV_PROPOSAL_LIMITS.skills).default([]),
    languages: z.array(cvProposalItemSchemas.language).max(CV_PROPOSAL_LIMITS.languages).default([]),
    certificates: z.array(cvProposalItemSchemas.certificate).max(CV_PROPOSAL_LIMITS.certificates).default([]),
    experienceYears: cvProposalItemSchemas.experienceYears.nullable().default(null),
  })
  .strict()
  .superRefine((v, ctx) => {
    // #805: dwie zatwierdzone pozycje o tej samej znormalizowanej nazwie języka (niezależnie od
    // poziomu) nie mają jednoznacznego wyniku w RPC — odrzucamy je tu, zanim dojdzie do zapisu.
    const seenAt = new Map<string, number>();
    v.languages.forEach((item, index) => {
      const key = normalizeLanguageName(item.language);
      const firstIndex = seenAt.get(key);
      if (firstIndex !== undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languages', index, 'language'], message: 'duplicate' });
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['languages', firstIndex, 'language'], message: 'duplicate' });
      } else {
        seenAt.set(key, index);
      }
    });
  });

/** Rodzaj błędu pola (klucz komunikatu wybiera UI). */
export type CvProposalValueProblem =
  | 'required'
  | 'tooLong'
  | 'disallowed'
  | 'languageInvalid'
  | 'experienceInvalid'
  | 'languageDuplicate';

/**
 * Identyfikatory propozycji języka wśród `items`, których znormalizowana nazwa się powtarza
 * (#805) — do wskazania konfliktu w UI PRZED wysłaniem (`applyCvProposals` i tak odrzuci je
 * ponownie w `cvApprovedProposalsSchema`, jako obrona w głębi).
 */
export function findDuplicateLanguageIds(items: { id: string; language: string }[]): Set<string> {
  const idsByName = new Map<string, string[]>();
  for (const item of items) {
    const key = normalizeLanguageName(item.language);
    if (!key) continue;
    const ids = idsByName.get(key) ?? [];
    ids.push(item.id);
    idsByName.set(key, ids);
  }
  const duplicates = new Set<string>();
  for (const ids of idsByName.values()) {
    if (ids.length > 1) for (const id of ids) duplicates.add(id);
  }
  return duplicates;
}

/**
 * Lata doświadczenia z pola tekstowego: tylko cyfry (bez „5,5”, „-1”, „5 lat”); pusty = brak
 * liczby. Zwraca `NaN` dla wartości niebędącej liczbą całkowitą — schemat ją odrzuci.
 */
export function parseExperienceYears(value: string): number {
  const v = value.trim();
  return /^\d{1,3}$/.test(v) ? Number(v) : Number.NaN;
}

/**
 * Sprawdza jedną (poprawioną) wartość propozycji tymi samymi schematami co akcja zapisu.
 * `null` = wartość poprawna.
 */
export function proposalValueProblem(
  kind: CvProposalKind,
  value: string,
  level: LanguageLevel = 'basic',
): CvProposalValueProblem | null {
  if (kind === 'experienceYears') {
    if (!value.trim()) return 'required';
    return cvProposalItemSchemas.experienceYears.safeParse(parseExperienceYears(value)).success ? null : 'experienceInvalid';
  }
  if (!value.trim()) return 'required';
  if (kind === 'language') {
    const res = cvProposalItemSchemas.language.safeParse({ language: value, level });
    if (res.success) return null;
    return res.error.issues.some((i) => i.code === 'custom') ? 'disallowed' : 'languageInvalid';
  }
  const res = cvProposalItemSchemas[kind].safeParse(value);
  if (res.success) return null;
  const issue = res.error.issues[0];
  if (issue?.code === 'too_big') return 'tooLong';
  if (issue?.code === 'too_small') return 'required';
  return 'disallowed';
}

/** Maksymalna długość pola tekstowego danej propozycji (do komunikatu „maks. N znaków”). */
export function proposalValueMaxLength(kind: Exclude<CvProposalKind, 'experienceYears'>): number {
  const schema = kind === 'language' ? candidateLanguageSchema.shape.language : cvProposalItemSchemas[kind].innerType();
  return schema.maxLength ?? 0;
}
