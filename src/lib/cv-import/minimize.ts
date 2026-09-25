import {
  findSensitiveData,
  IDENTIFIER_KINDS,
  redactSensitiveData,
} from '@/lib/privacy/sensitive-data';

/**
 * Minimalizacja tekstu CV PRZED wysłaniem do modelu (#487, #498). Moduł czysty (bez
 * `server-only`), deterministyczny i testowalny — ochrona NIE opiera się na poleceniu
 * w prompcie.
 *
 * Kolejność:
 *   1. Numer NISS/BIS, PESEL albo numer dokumentu w CAŁYM tekście (także w sekcjach, które
 *      i tak usuwamy) → odmowa (`identifier`). Detektor wspólny z #495/#500
 *      (`src/lib/privacy/sensitive-data.ts`).
 *   2. Sekcje z nagłówkiem „Referencje / References / Referenties / Références…” oraz
 *      „Dane osobowe / Kontakt / Personal details…” usuwamy w całości (do następnego
 *      znanego nagłówka). To dane osób trzecich (referenci) i dane kandydata niepotrzebne
 *      do propozycji pól zawodowych.
 *   3. Pojedyncze linie spoza tych sekcji usuwamy, gdy wskazują na osobę trzecią
 *      (referencja, osoba kontaktowa, „Przełożony: Jan …”), na dane osobowe kandydata
 *      (data urodzenia, stan cywilny, obywatelstwo, adres) albo na kategorie szczególne
 *      (zdrowie/niepełnosprawność, religia, związki zawodowe, poglądy, pochodzenie,
 *      orientacja, karalność — art. 9/10 RODO). Po linii-etykiecie („Referencje:”) usuwamy
 *      też kolejne linie do pustej linii.
 *   4. Wszystkie e-maile, telefony i linki → znaczniki (`redactSensitiveData` + URL-e).
 *   5. Bezpieczne zatrzymanie (`uncertain`): dane kontaktowe znalezione POZA nagłówkiem
 *      dokumentu (pierwsze linie, gdzie kandydat zwykle podaje własny kontakt) albo więcej
 *      niż jeden adres e-mail oznaczają, że w treści mogą być kontakty osób trzecich, których
 *      nie da się wiarygodnie oddzielić — nic nie wysyłamy, kandydat wypełnia profil ręcznie.
 *
 * Zwracamy wyłącznie LICZBY usuniętych fragmentów (bez wartości) — nadają się do UI,
 * nie trafiają do logów.
 */

export interface CvRedactionCounts {
  /** Usunięte sekcje referencji (nagłówek + treść). */
  referenceSections: number;
  /** Usunięte sekcje danych osobowych/kontaktowych. */
  personalSections: number;
  /** Pojedyncze linie o osobach trzecich (referencja, osoba kontaktowa, przełożony). */
  thirdPartyLines: number;
  /** Linie z danymi osobowymi kandydata (data urodzenia, adres, stan cywilny…). */
  personalLines: number;
  /** Linie z kategoriami szczególnymi (art. 9/10 RODO). */
  specialCategoryLines: number;
  /** E-maile, telefony i linki zastąpione znacznikiem. */
  contacts: number;
}

export type CvMinimizeResult =
  | { ok: true; text: string; counts: CvRedactionCounts }
  | { ok: false; reason: 'identifier' | 'uncertain' | 'empty' };

/** Liczba pierwszych niepustych linii traktowanych jako nagłówek CV (własny kontakt). */
export const CV_HEADER_LINES = 8;

type Heading = 'references' | 'personal' | 'other';

/**
 * Sekcja referencji trwa do następnego ZNANEGO nagłówka (bezpieczniej usunąć za dużo);
 * sekcja danych osobowych — najwyżej tyle niepustych linii (potem pojedyncze linie i tak
 * przechodzą przez filtry danych osobowych i kontaktów).
 */
const PERSONAL_SECTION_MAX_LINES = 10;

const REFERENCE_HEADINGS = [
  'referencje',
  'referencje zawodowe',
  'osoby polecające',
  'osoby do kontaktu',
  'rekomendacje',
  'references',
  'referees',
  'professional references',
  'reference',
  'referenties',
  'referentie',
  'referenten',
  'aanbevelingen',
  'références',
  'référence',
  'références professionnelles',
  'recommandations',
  'referenzen',
];
const PERSONAL_HEADINGS = [
  'dane osobowe',
  'dane kontaktowe',
  'kontakt',
  'informacje osobiste',
  'personal details',
  'personal information',
  'personal data',
  'contact',
  'contact details',
  'contact information',
  'persoonlijke gegevens',
  'persoonsgegevens',
  'contactgegevens',
  'informations personnelles',
  'données personnelles',
  'coordonnées',
  'état civil',
  'persönliche daten',
  'kontaktdaten',
];
const OTHER_HEADINGS = [
  'doświadczenie',
  'doświadczenie zawodowe',
  'przebieg pracy',
  'historia zatrudnienia',
  'wykształcenie',
  'edukacja',
  'umiejętności',
  'kompetencje',
  'języki',
  'języki obce',
  'znajomość języków',
  'certyfikaty',
  'kursy',
  'szkolenia',
  'kursy i szkolenia',
  'uprawnienia',
  'prawo jazdy',
  'profil',
  'profil zawodowy',
  'podsumowanie',
  'o mnie',
  'zainteresowania',
  'hobby',
  'experience',
  'work experience',
  'professional experience',
  'employment history',
  'education',
  'skills',
  'key skills',
  'languages',
  'certificates',
  'certifications',
  'courses',
  'training',
  'licences',
  'licenses',
  'driving licence',
  'driving license',
  'summary',
  'profile',
  'about me',
  'interests',
  'hobbies',
  'werkervaring',
  'ervaring',
  'beroepservaring',
  'opleiding',
  'opleidingen',
  'vaardigheden',
  'competenties',
  'talen',
  'talenkennis',
  'certificaten',
  'attesten',
  'cursussen',
  'rijbewijs',
  'profiel',
  'over mij',
  'interesses',
  'expérience',
  'expériences',
  'expérience professionnelle',
  'parcours professionnel',
  'formation',
  'formations',
  'compétences',
  'langues',
  'certificats',
  'certifications',
  'permis de conduire',
  'profil professionnel',
  'à propos de moi',
  "centres d'intérêt",
  'loisirs',
  'berufserfahrung',
  'ausbildung',
  'kenntnisse',
  'sprachen',
  'zertifikate',
  'führerschein',
];

function headingKey(line: string): string {
  return line
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/^[\s•*·\-–—#>|]+/, '')
    .replace(/[\s:：.\-–—|]+$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const HEADINGS = new Map<string, Heading>([
  ...OTHER_HEADINGS.map((h) => [h, 'other'] as const),
  ...PERSONAL_HEADINGS.map((h) => [h, 'personal'] as const),
  ...REFERENCE_HEADINGS.map((h) => [h, 'references'] as const),
]);

/** Rodzaj nagłówka sekcji albo `null`, gdy linia nie jest znanym nagłówkiem. */
export function cvHeadingKind(line: string): Heading | null {
  if (line.length > 60) return null;
  return HEADINGS.get(headingKey(line)) ?? null;
}

const L = String.raw`(?<!\p{L})`;
const R = String.raw`\p{L}*`;

/** Linie wskazujące na osobę trzecią (referent, osoba kontaktowa). */
const THIRD_PARTY_LINE = new RegExp(
  [
    `${L}(?:referencj|referen[ct]|r[ée]f[ée]renc|referee|rekomendacj|polecaj[ąa]c|aanbeveling|recommandation|empfehlung)${R}`,
    `${L}(?:osoba|osoby) (?:kontaktow|do kontaktu|polecaj)${R}`,
    `${L}(?:contact ?person|contactpersoon|personne de contact|ansprechpartner)${R}`,
  ].join('|'),
  'iu',
);

const SUPERVISOR_ROLES = [
  'przełożony',
  'przełożona',
  'kierownik',
  'szef',
  'szefowa',
  'manager',
  'supervisor',
  'line manager',
  'leidinggevende',
  'verantwoordelijke',
  'chef',
  'responsable',
  'vorgesetzter',
  'vorgesetzte',
];
/**
 * „Przełożony: Jan Kowalski”, „Supervisor – Anna Smith”: rola, dwukropek/myślnik i imię
 * z nazwiskiem (dwa wyrazy od wielkiej litery). Bez flagi `i` — `\p{Lu}` musi znaczyć
 * wielką literę; wielkość liter roli rozpisujemy jawnie.
 */
const SUPERVISOR_LINE = new RegExp(
  `${L}(?:${SUPERVISOR_ROLES.flatMap((r) => [r, r[0]!.toUpperCase() + r.slice(1), r.toUpperCase()]).join('|')})` +
    String.raw`\s*[:\-–—]\s*\p{Lu}\p{Ll}+\s+\p{Lu}`,
  'u',
);

/** Dane osobowe kandydata niepotrzebne do pól zawodowych. */
const PERSONAL_LINE = new RegExp(
  [
    `${L}(?:data|miejsce) urodzenia`,
    `${L}(?:date|place) of birth`,
    `${L}(?:geboortedatum|geboorteplaats|geboren)`,
    `${L}(?:date|lieu) de naissance`,
    `${L}née?\\s+le(?!\\p{L})`,
    `${L}geburts(?:datum|ort)`,
    `${L}stan cywilny`,
    `${L}marital status`,
    `${L}burgerlijke staat`,
    `${L}[ée]tat civil`,
    `${L}familienstand`,
    `${L}(?:obywatelstwo|narodowo[śs][ćc]|nationality|citizenship|nationaliteit|nationalit[ée]|staatsangeh[öo]rigkeit)`,
    `${L}(?:p[łl]e[ćc]|gender|geslacht|sexe|geschlecht)\\s*:`,
    `${L}(?:adres(?: zamieszkania)?|address|adresse|woonplaats|domicile|wohnort)\\s*:`,
    `${L}(?:wiek|age|leeftijd|[âa]ge|alter)\\s*:`,
  ].join('|'),
  'iu',
);

/** Kategorie szczególne (art. 9) i dane o karalności (art. 10 RODO). */
const SPECIAL_CATEGORY_LINE = new RegExp(
  [
    // zdrowie / niepełnosprawność
    `${L}(?:stan zdrowia|niepe[łl]nosprawn|orzeczeni${R} o (?:stopniu )?niepe[łl]nosprawn)${R}`,
    `${L}(?:health (?:condition|status|problems?)|disabilit|disabled|handicap|invalidit)${R}`,
    `${L}(?:gezondheidstoestand|gezondheidsprobleem|gezondheidsproblemen|arbeidsongeschikt|invaliditeit)${R}`,
    `${L}(?:[ée]tat de sant[ée]|probl[èe]mes? de sant[ée]|invalidit[ée])${R}`,
    // religia / światopogląd / poglądy polityczne / związki zawodowe
    `${L}(?:religi|wyznani|godsdienst|confession religieuse|ko[śs]ci[oó][łl])${R}`,
    `${L}(?:pogl[ąa]dy polityczne|political (?:views|opinions|party)|politieke|opinions? politiques?|partia polityczna)${R}`,
    `${L}(?:zwi[ąa]zk${R} zawodow|trade union|labou?r union|vakbond|syndica)${R}`,
    // pochodzenie / orientacja
    `${L}(?:pochodzeni${R} etniczn|ethnic|etnisch|ethnique)${R}`,
    `${L}(?:orientacj${R} seksualn|sexual orientation|seksuele geaardheid|orientation sexuelle)${R}`,
    // karalność (art. 10)
    `${L}(?:niekaraln|karaln|wyrok|skazan|criminal record|conviction|strafblad|strafregister|veroordeel|veroordel|casier judiciaire|condamn|bonne vie et m[œo]eurs|goed gedrag en zeden|f[üu]hrungszeugnis|vorstraf)${R}`,
  ].join('|'),
  'iu',
);

const URL_SOURCE = String.raw`(?:https?:\/\/|www\.)[^\s<>"')]+`;
const URL_PATTERN = new RegExp(URL_SOURCE, 'giu');
const HAS_URL = new RegExp(URL_SOURCE, 'iu');
const LINK_MARKER = '[link removed]';

function isBlank(line: string): boolean {
  return line.trim() === '';
}

export function minimizeCvText(input: string): CvMinimizeResult {
  const text = input.replace(/\r\n?/g, '\n');
  if (!text.trim()) return { ok: false, reason: 'empty' };

  // 1. Identyfikatory osób/dokumentów → odmowa (fail-closed, także w sekcjach do usunięcia).
  if (findSensitiveData(text, IDENTIFIER_KINDS).length > 0) return { ok: false, reason: 'identifier' };

  const counts: CvRedactionCounts = {
    referenceSections: 0,
    personalSections: 0,
    thirdPartyLines: 0,
    personalLines: 0,
    specialCategoryLines: 0,
    contacts: 0,
  };

  // 2–3. Sekcje i linie.
  const kept: string[] = [];
  let section: Heading = 'other';
  /** Sekcja danych osobowych jest krótka: po `PERSONAL_SECTION_MAX_LINES` liniach wracamy do treści. */
  let sectionLines = 0;
  /** Liczba kolejnych linii do usunięcia po etykiecie „Referencje:” (bez pustej linii — PDF). */
  let dropBlock = 0;
  for (const line of text.split('\n')) {
    const heading = cvHeadingKind(line);
    if (heading) {
      section = heading;
      sectionLines = 0;
      dropBlock = 0;
      if (heading === 'references') counts.referenceSections += 1;
      else if (heading === 'personal') counts.personalSections += 1;
      else kept.push(line);
      continue;
    }
    if (section === 'personal' && !isBlank(line) && ++sectionLines > PERSONAL_SECTION_MAX_LINES) section = 'other';
    if (section !== 'other') continue;
    if (dropBlock > 0) {
      if (isBlank(line)) dropBlock = 0;
      else {
        dropBlock -= 1;
        counts.thirdPartyLines += 1;
        continue;
      }
    }
    if (THIRD_PARTY_LINE.test(line) || SUPERVISOR_LINE.test(line)) {
      counts.thirdPartyLines += 1;
      // Etykieta bez treści („Referencje:”) — treść w kolejnych liniach (najwyżej 6, do pustej).
      if (/[:：]\s*$/.test(line)) dropBlock = 6;
      continue;
    }
    if (SPECIAL_CATEGORY_LINE.test(line)) {
      counts.specialCategoryLines += 1;
      continue;
    }
    if (PERSONAL_LINE.test(line)) {
      counts.personalLines += 1;
      continue;
    }
    kept.push(line);
  }

  // 5. Niepewność: kontakt poza nagłówkiem dokumentu albo kilka adresów e-mail.
  let nonBlank = 0;
  let emails = 0;
  for (const line of kept) {
    if (isBlank(line)) continue;
    nonBlank += 1;
    const found = findSensitiveData(line, ['email', 'phone']);
    emails += found.filter((m) => m.kind === 'email').length;
    if (found.length > 0 && nonBlank > CV_HEADER_LINES) return { ok: false, reason: 'uncertain' };
  }
  if (emails > 1) return { ok: false, reason: 'uncertain' };

  // 4. E-maile, telefony, linki → znaczniki.
  const redacted = redactSensitiveData(kept.join('\n'), ['email', 'phone']);
  counts.contacts += redacted.counts.email + redacted.counts.phone;
  const out = redacted.text
    .replace(URL_PATTERN, () => {
      counts.contacts += 1;
      return LINK_MARKER;
    })
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!out) return { ok: false, reason: 'empty' };
  return { ok: true, text: out, counts };
}

/** Czy wartość (propozycja modelu) zawiera daną, której nie przenosimy do profilu. */
export function isDisallowedProposalText(value: string): boolean {
  return (
    findSensitiveData(value).length > 0 ||
    /\[(?:email|phone|identifier|link) removed\]/i.test(value) ||
    HAS_URL.test(value) ||
    SPECIAL_CATEGORY_LINE.test(value) ||
    THIRD_PARTY_LINE.test(value) ||
    SUPERVISOR_LINE.test(value)
  );
}
