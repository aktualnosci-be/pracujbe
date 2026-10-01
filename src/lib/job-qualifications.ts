/**
 * Umiejętności i certyfikaty oferty na publicznym szczególe (decyzja właściciela 01.10.2026,
 * #866): kandydat widzi kwalifikacje, po których znalazł ofertę słowem kluczowym. Dane z relacji
 * `job_skills` / `job_certificates` czytanych pod rolą anon (RLS `*_select`: tylko oferta
 * publiczna — `job_is_public`), bez migracji.
 *
 * Moduł czysty (bez bazy i Reacta): parser wierszy, deduplikacja i etykiety JSON-LD.
 */

/** Pozycja kwalifikacji do wyświetlenia. */
export interface JobQualificationItem {
  /** Nazwa do pokazania: ze słownika w języku widza albo wpis pracodawcy. */
  label: string;
  /**
   * `true` = nazwa ze słownika umiejętności w języku strony (`skill_labels`); `false` = wpis
   * pracodawcy w języku treści oferty (strona daje mu `lang`, gdy różni się od języka strony).
   */
  localized: boolean;
}

export interface JobQualifications {
  skillsMandatory: JobQualificationItem[];
  skillsOptional: JobQualificationItem[];
  certificates: JobQualificationItem[];
}

/** Sufity zgodne z `JOB_ITEM_LIMITS` kreatora i CHECK-ami relacji (0030). */
const SKILL_MAX = 120;
const CERTIFICATE_MAX = 160;
/** Ochrona widoku: tyle pozycji każdego rodzaju najwyżej trafia na stronę. */
export const QUALIFICATIONS_DISPLAY_LIMIT = 30;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/\s+/g, ' ').trim();
  if (text === '' || text.length > max) return null;
  return text;
}

/** Klucz deduplikacji: bez wielkości liter i różnic białych znaków (jak lista w kreatorze). */
function itemKey(label: string): string {
  return label.toLocaleLowerCase('und');
}

function pushUnique(list: JobQualificationItem[], seen: Set<string>, item: JobQualificationItem): void {
  if (list.length >= QUALIFICATIONS_DISPLAY_LIMIT) return;
  const key = itemKey(item.label);
  if (seen.has(key)) return;
  seen.add(key);
  list.push(item);
}

/**
 * Wiersze z `getPublicJobQualifications`:
 * - umiejętność: `{ skill_label, is_mandatory, localized_label }` (`localized_label` = nazwa
 *   preferowana słownika w języku strony albo null),
 * - certyfikat: `{ certificate_label }`.
 * Wiersz niepoprawny (pusty, za długi, zły typ) jest pomijany. Ta sama nazwa raz — umiejętność
 * obowiązkowa wygrywa z opcjonalną. Brak jakiejkolwiek pozycji = `undefined` (strona bez sekcji).
 */
export function parseJobQualifications(
  skillRows: readonly unknown[],
  certificateRows: readonly unknown[],
): JobQualifications | undefined {
  const skillsMandatory: JobQualificationItem[] = [];
  const skillsOptional: JobQualificationItem[] = [];
  const certificates: JobQualificationItem[] = [];
  const seenSkills = new Set<string>();
  const seenCertificates = new Set<string>();

  const skills = skillRows.map(asRecord);
  // Obowiązkowe najpierw, żeby duplikat nazwy zawsze lądował po stronie „wymagane”.
  const ordered = [
    ...skills.filter((row) => row['is_mandatory'] === true),
    ...skills.filter((row) => row['is_mandatory'] !== true),
  ];
  for (const row of ordered) {
    const raw = cleanText(row['skill_label'], SKILL_MAX);
    if (!raw) continue;
    const localizedLabel = cleanText(row['localized_label'], 1000);
    const item: JobQualificationItem = localizedLabel
      ? { label: localizedLabel, localized: true }
      : { label: raw, localized: false };
    pushUnique(row['is_mandatory'] === true ? skillsMandatory : skillsOptional, seenSkills, item);
  }

  for (const row of certificateRows.map(asRecord)) {
    const label = cleanText(row['certificate_label'], CERTIFICATE_MAX);
    if (!label) continue;
    pushUnique(certificates, seenCertificates, { label, localized: false });
  }

  if (skillsMandatory.length + skillsOptional.length + certificates.length === 0) return undefined;
  return { skillsMandatory, skillsOptional, certificates };
}

/**
 * Pola JobPosting (schema.org): `skills` (Text — lista nazw) i `qualifications`
 * (`EducationalOccupationalCredential` z kategorią „certificate”). Puste listy = brak pól.
 */
export function jobQualificationsJsonLd(
  qualifications: JobQualifications | undefined,
): Record<string, unknown> {
  if (!qualifications) return {};
  const skills = [...qualifications.skillsMandatory, ...qualifications.skillsOptional].map((item) => item.label);
  const credentials = qualifications.certificates.map((item) => ({
    '@type': 'EducationalOccupationalCredential',
    credentialCategory: 'certificate',
    name: item.label,
  }));
  return {
    ...(skills.length > 0 ? { skills: skills.join(', ') } : {}),
    ...(credentials.length > 0 ? { qualifications: credentials } : {}),
  };
}
