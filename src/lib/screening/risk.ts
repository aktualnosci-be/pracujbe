import type { LocalizedText } from '@/lib/screening/questions';

/**
 * Kontrola treści pytań screeningowych przed publikacją (#497).
 *
 * Deterministyczny detektor (słowniki/wzorce PL/NL/FR/EN, bez modelu językowego) wskazuje
 * pytania, które MOGĄ dotyczyć danych chronionych albo kryteriów objętych zakazem
 * dyskryminacji (wiek, płeć, ciąża i plany rodzinne, stan cywilny, religia, pochodzenie,
 * zdrowie, orientacja, związki zawodowe, poglądy polityczne, karalność). Trafienie NIE jest
 * oceną prawną: kieruje pytanie do przeglądu przez człowieka (admin portalu), a do czasu
 * decyzji oferta nie może zostać opublikowana. Brak trafienia nie dowodzi zgodności.
 *
 * Decyzję podejmuje BAZA: te same wzorce i to samo składanie znaków są w migracji
 * `0104_screening_question_review.sql` (`screening_risk_patterns`, `screening_fold`) —
 * test `screening-risk.test.ts` porównuje oba zestawy. Ten moduł służy do podpowiedzi
 * w kreatorze (przed zapisem) i do testów.
 *
 * Moduł bez Zoda i bez zależności serwerowych (trafia do bundla kreatora).
 */

export const SCREENING_RISK_CATEGORIES = [
  'age',
  'sex',
  'family',
  'marital',
  'religion',
  'origin',
  'health',
  'orientation',
  'union',
  'political',
  'criminal',
] as const;
export type ScreeningRiskCategory = (typeof SCREENING_RISK_CATEGORIES)[number];

/**
 * Składanie znaków: te znaki zamieniane są 1:1 na odpowiadające litery ASCII (wielkie
 * i małe osobno — `lower()` w PostgreSQL z lokalizacją C nie zmienia znaków spoza ASCII).
 * Identyczne literały są w `screening_fold` (migracja 0104).
 */
export const SCREENING_FOLD_FROM =
  'ąćęłńóśźżàâäáãåçéèêëíìîïñòôöõúùûüýÿĄĆĘŁŃÓŚŹŻÀÂÄÁÃÅÇÉÈÊËÍÌÎÏÑÒÔÖÕÚÙÛÜÝŸøØ';
export const SCREENING_FOLD_TO =
  'acelnoszzaaaaaaceeeeiiiinoooouuuuyyACELNOSZZAAAAAACEEEEIIIINOOOOUUUUYYoO';

/**
 * Wzorce (składnia wspólna dla JS RegExp i PostgreSQL ARE) dopasowywane do tekstu po
 * `foldScreeningText`: małe litery ASCII i cyfry, pojedyncze spacje, spacja na początku
 * i końcu — spacja pełni rolę granicy słowa (` wiek ` nie trafia w „człowiek”).
 *
 * Wzorce są celowo wąskie (np. „orientacja seksualna”, nie „orientacja w terenie”;
 * „związek zawodowy”, nie „w związku z”) — typowe pytania o doświadczenie, prawo jazdy,
 * dostępność, języki i uprawnienia nie mogą trafiać do przeglądu.
 */
export const SCREENING_RISK_PATTERNS: readonly (readonly [ScreeningRiskCategory, string])[] = [
  // Wiek / data urodzenia
  ['age', ' wiek(u|iem)? '],
  ['age', ' ile masz lat '],
  ['age', ' ile (pan|pani) ma lat '],
  ['age', ' (data|daty|date|dacie|rok|roku) urodzenia '],
  ['age', ' urodzil(a|es|as|em|am)? '],
  ['age', ' how old '],
  ['age', ' age '],
  ['age', ' (date|year) of birth '],
  ['age', ' birth ?date '],
  ['age', ' birthday '],
  ['age', ' dob '],
  ['age', ' were you born '],
  ['age', ' leeftijd '],
  ['age', ' geboorte(datum|jaar) '],
  ['age', ' hoe oud '],
  ['age', ' wanneer (ben je|bent u) geboren '],
  ['age', ' (quel|votre|ton) age '],
  ['age', ' (date|annee) de naissance '],
  ['age', ' etes vous ne(e)? '],
  // Płeć
  ['sex', ' plec '],
  ['sex', ' plci '],
  ['sex', ' (jestes|czy jest pan|czy jest pani) (kobieta|mezczyzna) '],
  ['sex', ' kobieta czy mezczyzna '],
  ['sex', ' mezczyzna czy kobieta '],
  ['sex', ' gender '],
  ['sex', ' sex '],
  ['sex', ' (male|man) or (female|woman) '],
  ['sex', ' (female|woman) or (male|man) '],
  ['sex', ' are you (a )?(man|woman|male|female) '],
  ['sex', ' geslacht '],
  ['sex', ' man of vrouw '],
  ['sex', ' vrouw of man '],
  ['sex', ' (ben je|bent u) een (man|vrouw) '],
  ['sex', ' sexe '],
  ['sex', ' homme ou (une )?femme '],
  ['sex', ' femme ou (un )?homme '],
  ['sex', ' etes vous (un homme|une femme) '],
  // Ciąża, macierzyństwo, dzieci, plany rodzinne
  ['family', ' ciaz'],
  ['family', ' macierzy[a-z]* '],
  ['family', ' (urlop[a-z]*|urlopie) (rodzicielsk|ojcowsk|wychowawcz)'],
  ['family', ' (masz|macie|posiadasz|pan ma|pani ma) dzieci '],
  ['family', ' ile (masz )?dzieci '],
  ['family', ' (planujesz|planuje pan|planuje pani|planujecie) [a-z ]*(dzieci|dziecko|rodzine|ciaze) '],
  ['family', ' plany rodzinne '],
  ['family', ' powiekszeni[a-z]* rodziny '],
  ['family', ' pregnan'],
  ['family', ' (maternity|paternity) '],
  ['family', ' (have|any) (children|kids) '],
  ['family', ' plan(ning)? to have (children|kids|a baby) '],
  ['family', ' (start|starting) a family '],
  ['family', ' family plans '],
  ['family', ' zwanger'],
  ['family', ' kinderwens '],
  ['family', ' (heb je|hebt u|heeft u|heb jij) kinderen '],
  ['family', ' kinderen (krijgen|plannen) '],
  ['family', ' (moederschap|bevallingsverlof|zwangerschapsverlof|ouderschapsverlof)[a-z]* '],
  ['family', ' gezinsuitbreiding '],
  ['family', ' enceinte '],
  ['family', ' grossesse '],
  ['family', ' (avez vous|as tu) des enfants '],
  ['family', ' enfants a charge '],
  ['family', ' (desir|projet|projets) d enfant'],
  ['family', ' (conge de )?maternite '],
  // Stan cywilny
  ['marital', ' stan cywilny '],
  ['marital', ' stanu cywilnego '],
  ['marital', ' (zonaty|zonata|zamezna|zamezny|rozwiedzion[a-z]*|wdow[a-z]*) '],
  ['marital', ' malzon[a-z]* '],
  ['marital', ' marital '],
  ['marital', ' (married|divorced|widowed|widow|widower|spouse|husband|wife) '],
  ['marital', ' burgerlijke staat '],
  ['marital', ' (getrouwd|gehuwd|gescheiden|weduwe|weduwnaar|echtgenoot|echtgenote) '],
  ['marital', ' etat civil '],
  ['marital', ' situation (familiale|matrimoniale) '],
  ['marital', ' (marie|mariee|celibataire|divorce|divorcee|veuf|veuve|conjoint|conjointe|epoux|epouse) '],
  // Religia / światopogląd
  ['religion', ' religi'],
  ['religion', ' wyznani[a-z]* '],
  ['religion', ' wierzac[a-z]* '],
  ['religion', ' (kosciol|kosciola|kosciele|meczet[a-z]*|synagog[a-z]*) '],
  ['religion', ' (katoli|muzulma|chrzesci|zydow|prawoslaw|ewangeli)[a-z]* '],
  ['religion', ' (islam|ramadan|hidzab) '],
  ['religion', ' modli[a-z]* '],
  ['religion', ' (church|mosque|synagogue|faith|muslim|christian|jewish|hindu|buddhist|sabbath|ramadan|hijab|headscarf) '],
  ['religion', ' pray[a-z]* '],
  ['religion', ' (geloof|godsdienst[a-z]*|kerk|moskee|moslim|christen|christelijk|joods|hoofddoek|ramadan) '],
  ['religion', ' (bidden|bid je|bidt u) '],
  ['religion', ' (croyant|croyante|croyance[s]?|foi|eglise|mosquee|synagogue|musulman|musulmane|chretien|chretienne|juif|juive|ramadan|pratiquant|pratiquante) '],
  ['religion', ' (priere|prier|priez) '],
  // Pochodzenie, narodowość, rasa
  ['origin', ' (narodowos|obywatelst|pochodzeni|etniczn|rasow)[a-z]* '],
  ['origin', ' (rasa|rasy|rase) '],
  ['origin', ' kolor[a-z]* skory '],
  ['origin', ' skad pochodzisz '],
  ['origin', ' (kraj[a-z]*|miejsce|miejsca) urodzenia '],
  ['origin', ' (nationality|citizenship|ethnic|ethnicity|race|racial|origin) '],
  ['origin', ' skin colou?r '],
  ['origin', ' where are you (originally )?from '],
  ['origin', ' (country|place) of (origin|birth) '],
  ['origin', ' (nationaliteit|afkomst|herkomst|etnisch[a-z]*|huidskleur|ras|geboorteland|geboorteplaats|staatsburgerschap) '],
  ['origin', ' waar (kom je|komt u) vandaan '],
  ['origin', ' (nationalite|origine|origines|ethnie|ethnique|race|citoyennete) '],
  ['origin', ' couleur de peau '],
  ['origin', ' (pays|lieu) de naissance '],
  ['origin', ' d ou (venez vous|viens tu) '],
  // Zdrowie, niepełnosprawność
  ['health', ' zdrowi[a-z]* '],
  ['health', ' chorob[a-z]* '],
  ['health', ' (chory|chora|chorujesz|choruje) '],
  ['health', ' (niepelnospraw|niesprawn|inwalid)[a-z]* '],
  ['health', ' (lek|leki|lekow|lekarstw[a-z]*) '],
  ['health', ' zwolnieni[a-z]* lekarsk'],
  ['health', ' (alergi|uzaleznien|depresj|psychiatr|nowotw|cukrzyc|epileps)[a-z]* '],
  ['health', ' hiv '],
  ['health', ' health(?! (and )?safety)(?! ?care) '],
  ['health', ' (disabled|disability|disabilities|illness|illnesses|ill|sick|sickness|handicap|handicapped|chronic|medication|medications|diagnosis|diagnosed|allergy|allergies|depression) '],
  ['health', ' medical (condition|history|problem)'],
  ['health', ' mental (health|illness) '],
  ['health', ' (gezondheid|ziekte|ziekten|ziek|ziekteverlof|handicap|beperking|medicijnen|medicatie|chronisch|chronische|arbeidsongeschikt|invalide|allergie|depressie) '],
  ['health', ' sante(?! et securite) '],
  ['health', ' (maladie|maladies|malade|handicap|handicape|handicapee|invalidite|medicament|medicaments|chronique|allergie|allergies|depression) '],
  ['health', ' (arret|conge) maladie '],
  ['health', ' traitement medical '],
  // Orientacja seksualna, tożsamość płciowa
  ['orientation', ' orientacj[a-z]* seksualn'],
  ['orientation', ' (homoseksual|biseksual|lesbij|transplc|lgbt)[a-z]* '],
  ['orientation', ' (gej|geje|gejem) '],
  ['orientation', ' sexual (orientation|preference)'],
  ['orientation', ' (sexuality|gay|lesbian|bisexual|transgender|homosexual|lgbt|lgbtq) '],
  ['orientation', ' (seksuele )?geaardheid '],
  ['orientation', ' (homo|homoseksueel|lesbisch|biseksueel|transgender|holebi) '],
  ['orientation', ' orientation sexuelle '],
  ['orientation', ' (homosexuel|homosexuelle|lesbienne|gay|bisexuel|bisexuelle|transgenre|lgbt) '],
  // Związki zawodowe
  ['union', ' zwiaz[a-z]* zawodow'],
  ['union', ' zwiazkow(iec|cem|ca|a|y|ej|ym) '],
  ['union', ' (trade|labou?r) union'],
  ['union', ' union member'],
  ['union', ' unioni[sz]ed '],
  ['union', ' (vakbond|vakbonden|vakbondslid|vakbondslidmaatschap) '],
  ['union', ' (acv|abvv|aclvb|fgtb|csc|cgslb) '],
  ['union', ' (syndicat|syndicats|syndique|syndiquee|syndical|syndicale|syndicaliste) '],
  // Poglądy polityczne
  ['political', ' polityczn'],
  ['political', ' political '],
  ['political', ' (vote|voted|voting) for '],
  ['political', ' politieke (voorkeur|overtuiging|partij|mening)'],
  ['political', ' (opinion|opinions|conviction|convictions|parti|preference) politique'],
  // Karalność
  ['criminal', ' (karan|niekaran|karalnos|niekaralnos|skazan)[a-z]* '],
  ['criminal', ' (wyrok|wyroki|wyrokiem|wiezieni[a-z]*|kartotek[a-z]*) '],
  ['criminal', ' rejestr[a-z]* karn'],
  ['criminal', ' (criminal|convicted|conviction|convictions|felony|prison|jail) '],
  ['criminal', ' police (record|check)'],
  ['criminal', ' (strafblad|strafregister|veroordeeld|veroordeling|gevangenis) '],
  ['criminal', ' (goed gedrag|goed gedrag en zeden) '],
  ['criminal', ' casier judiciaire '],
  ['criminal', ' (condamne|condamnee|condamnation|condamnations|prison) '],
  ['criminal', ' bonne vie et moeurs '],
  ['criminal', ' bonnes vie et moeurs '],
];

const FOLD_MAP: ReadonlyMap<string, string> = (() => {
  const from = Array.from(SCREENING_FOLD_FROM);
  const to = Array.from(SCREENING_FOLD_TO);
  return new Map(from.map((char, i) => [char, to[i] ?? ' ']));
})();

/**
 * Tekst do dopasowania: znaki ze słownika na ASCII, œ/æ/ß rozwinięte, małe litery, wszystko
 * poza [a-z0-9] → spacja, pojedyncze spacje, spacja na początku i końcu.
 * Lustro `public.screening_fold` (0104).
 */
export function foldScreeningText(text: string): string {
  const folded = Array.from(text)
    .map((char) => FOLD_MAP.get(char) ?? char)
    .join('')
    .replace(/œ/g, 'oe')
    .replace(/Œ/g, 'OE')
    .replace(/æ/g, 'ae')
    .replace(/Æ/g, 'AE')
    .replace(/ß/g, 'ss')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return ` ${folded} `;
}

const COMPILED: readonly (readonly [ScreeningRiskCategory, RegExp])[] = SCREENING_RISK_PATTERNS.map(
  ([category, pattern]) => [category, new RegExp(pattern)] as const,
);

/** Kategorie ryzyka pojedynczego tekstu (posortowane, bez powtórzeń). */
export function screeningTextRisk(text: string): ScreeningRiskCategory[] {
  const folded = foldScreeningText(text);
  const found = new Set<ScreeningRiskCategory>();
  for (const [category, re] of COMPILED) {
    if (re.test(folded)) found.add(category);
  }
  return SCREENING_RISK_CATEGORIES.filter((category) => found.has(category));
}

/**
 * Kategorie ryzyka pytania: treść i KAŻDA opcja we WSZYSTKICH językach (tłumaczenie nie omija
 * kontroli). Pusta lista = pytanie nie wymaga przeglądu.
 */
export function screeningQuestionRisk(question: {
  prompt: LocalizedText;
  options?: readonly { label: LocalizedText }[];
}): ScreeningRiskCategory[] {
  const texts = [
    ...Object.values(question.prompt),
    ...(question.options ?? []).flatMap((option) => Object.values(option.label)),
  ].filter((text): text is string => typeof text === 'string' && text.trim() !== '');
  const found = new Set(texts.flatMap((text) => screeningTextRisk(text)));
  return SCREENING_RISK_CATEGORIES.filter((category) => found.has(category));
}

export function isScreeningRiskCategory(value: unknown): value is ScreeningRiskCategory {
  return (
    typeof value === 'string' && (SCREENING_RISK_CATEGORIES as readonly string[]).includes(value)
  );
}

/** Status przeglądu pytania (tabela `screening_question_reviews`, 0104). */
export const SCREENING_REVIEW_STATUSES = ['pending', 'approved', 'rejected', 'superseded'] as const;
export type ScreeningReviewStatus = (typeof SCREENING_REVIEW_STATUSES)[number];

/** Limit uzasadnienia decyzji admina — ten sam co w `admin_decide_screening_review`. */
export const SCREENING_REVIEW_REASON_MAX = 1000;
