import { foldScreeningText } from '@/lib/screening/risk';

/**
 * Sygnały oszustwa w treści oferty (0910, zaufanie ofert).
 *
 * Deterministyczny detektor (wzorce PL/NL/FR/EN, bez modelu językowego) wskazuje treść,
 * która MOŻE oznaczać nieuczciwą ofertę: opłatę od kandydata (za pracę, szkolenie, dokumenty,
 * zakwaterowanie z góry), przeniesienie kontaktu do komunikatora, kryptowaluty i „zadania
 * online”, prośbę o przelew albo dane karty. Trafienie NIE jest oceną — kieruje treść do
 * przeglądu przez człowieka (admin portalu); do decyzji oferta nie zostanie opublikowana.
 * Brak trafienia nie dowodzi, że oferta jest uczciwa.
 *
 * Decyzję podejmuje BAZA: te same wzorce są w `job_fraud_patterns` (migracja
 * `0910_offer_trust.sql`), a tekst składa `screening_fold` (0103) — test
 * `job-fraud-risk.test.ts` porównuje oba zestawy 1:1. Ten moduł służy do podpowiedzi
 * w kreatorze (przed zapisem) i do testów. Bez Zoda i bez zależności serwerowych.
 */

export const JOB_FRAUD_CATEGORIES = [
  'candidate_fee',
  'off_platform_contact',
  'crypto_tasks',
  'payment_request',
] as const;
export type JobFraudCategory = (typeof JOB_FRAUD_CATEGORIES)[number];

/**
 * Wzorce (składnia wspólna dla JS RegExp i PostgreSQL ARE) dopasowywane do tekstu po
 * `foldScreeningText`: małe litery ASCII i cyfry, pojedyncze spacje, spacja na początku
 * i końcu (granica słowa). Celowo wąskie: wypłata wynagrodzenia przelewem, zwrot kosztów
 * dojazdu, zaliczka na wynagrodzenie czy koszt zakwaterowania potrącany z pensji nie trafiają.
 */
export const JOB_FRAUD_PATTERNS: readonly (readonly [JobFraudCategory, string])[] = [
  ['candidate_fee', ' oplat[a-z]* za (rekrutacj|prace|szkoleni|kurs|dokument|wiz|rejestracj|zatrudnieni|posrednictw|aplikacj)'],
  ['candidate_fee', ' (oplat[a-z]*|koszt[a-z]*) (rekrutacyjn|rejestracyjn|wpisow|administracyjn|manipulacyjn)'],
  ['candidate_fee', ' wpisowe '],
  ['candidate_fee', ' (wplac|wplat|zaplac|uiszcz)[a-z]* [a-z0-9 ]{0,30}(zaliczk|kaucj|oplat|wpisow)'],
  ['candidate_fee', ' kaucj[a-z]* (za|na) (mieszkani|zakwaterowani|pokoj|lozko|prac|miejsce)'],
  ['candidate_fee', ' (platne|platna|platny|oplata|wplata|zaplata) z gory '],
  ['candidate_fee', ' (recruitment|registration|placement|processing|application|administration|admin|training|visa|agency|booking|reservation) fees? '],
  ['candidate_fee', ' (pay|paying|payment of) (a |an |the )?(small )?(fee|deposit|registration) '],
  ['candidate_fee', ' upfront (payment|fee|deposit|cost) '],
  ['candidate_fee', ' (deposit|advance payment) (for|to secure) (the |your )?(accommodation|housing|room|job|position|place|visa) '],
  ['candidate_fee', ' pay (in advance|upfront|before (you )?start)'],
  ['candidate_fee', ' (inschrijvings|bemiddelings|registratie|opleidings|dossier|administratie|aanvraag)(kosten|geld) '],
  ['candidate_fee', ' waarborg (voor|van) (de |het |je |jouw )?(kamer|woning|huisvesting|verblijf|job|plaats|werk) '],
  ['candidate_fee', ' (vooraf|op voorhand|vooruit) (te )?betal'],
  ['candidate_fee', ' voorschot (betalen|storten|overmaken) '],
  ['candidate_fee', ' frais (d inscription|de dossier|de recrutement|de formation|de placement|d agence|de traitement|administratifs) '],
  ['candidate_fee', ' (caution|depot de garantie) (pour|de|du) (le |la |l |votre )?(logement|chambre|hebergement|poste|emploi|travail) '],
  ['candidate_fee', ' (payer|paiement|verser|regler) (d avance|a l avance|en avance|au prealable|avant de commencer) '],
  ['candidate_fee', ' (verser|payer) (un |une )?(acompte|avance|caution) '],
  ['off_platform_contact', ' whats ?app '],
  ['off_platform_contact', ' telegram '],
  ['off_platform_contact', ' viber '],
  ['off_platform_contact', ' wechat '],
  ['off_platform_contact', ' signal (app|messenger) '],
  ['off_platform_contact', ' wa me '],
  ['off_platform_contact', ' t me '],
  ['crypto_tasks', ' (kryptowalut[a-z]*|krypto|crypto|cryptos|cryptocurrenc[a-z]*|cryptomonnaies?|cryptomunt(en)?|cryptovaluta|bitcoins?|btc|usdt|tether|ethereum|binance) '],
  ['crypto_tasks', ' zadani[a-z]* (online|w internecie|przez internet) '],
  ['crypto_tasks', ' (online|internet) (tasks?|opdrachten|taken) '],
  ['crypto_tasks', ' (taches|missions) en ligne '],
  ['crypto_tasks', ' (like|likes|liking|liken|polubieni[a-z]*|lajkowani[a-z]*) (filmow|filmikow|videos?|posts?|produkt[a-z]*|products?) '],
  ['crypto_tasks', ' (optymalizacj[a-z]*|optimi[sz]ation|optimalisatie) (produkt[a-z]*|products?|app|apps|aplikacj[a-z]*|applications?) '],
  ['payment_request', ' western union '],
  ['payment_request', ' moneygram '],
  ['payment_request', ' paysafe ?card '],
  ['payment_request', ' (gift|prepaid|steam|itunes|google play) cards? '],
  ['payment_request', ' kart[a-z]* (podarunkow|przedplacon)'],
  ['payment_request', ' cartes? (cadeau|prepayee)'],
  ['payment_request', ' (cadeaukaart|prepaidkaart)'],
  ['payment_request', ' (numer|numeru|dane|danych) (twojej |swojej )?karty '],
  ['payment_request', ' (card|credit card|debit card|bank card) (number|details|data) '],
  ['payment_request', ' (cvv|cvc|cvv2) '],
  ['payment_request', ' (kaartnummer|kaartgegevens|bankkaartgegevens) '],
  ['payment_request', ' (numero|coordonnees|donnees) (de )?(votre )?carte (bancaire|de credit)'],
  ['payment_request', ' (przelej|przelac|wyslij|wyslac|wykonaj|wykonac|zrob|zrobic) [a-z0-9 ]{0,20}(przelew|pieniadz|kwot|blik)'],
  ['payment_request', ' (kod|kodu|kodem) blik '],
  ['payment_request', ' (send|wire|transfer) (us |me )?(the |a |your )?(money|payment|funds|amount|fee) '],
  ['payment_request', ' (geld|bedrag) (overmaken|overschrijven|storten|sturen) '],
  ['payment_request', ' (envoyer|effectuer|faire) (un |le )?(virement|paiement|transfert) '],
  ['payment_request', ' mandat cash '],
  ['payment_request', ' (dane logowania|login|haslo|password|wachtwoord|mot de passe) [a-z0-9 ]{0,20}(bank|banque)'],
];

const COMPILED: readonly (readonly [JobFraudCategory, RegExp])[] = JOB_FRAUD_PATTERNS.map(
  ([category, pattern]) => [category, new RegExp(pattern)] as const,
);

/**
 * Kategorie sygnałów dla zestawu tekstów (pola oferty) — posortowane, bez powtórzeń.
 * Każdy tekst jest składany osobno i sklejany jak w `job_fraud_risk` (0910).
 */
export function jobFraudRisk(texts: readonly (string | null | undefined)[]): JobFraudCategory[] {
  const folded = texts
    .filter((text): text is string => typeof text === 'string' && text.trim() !== '')
    .map((text) => foldScreeningText(text))
    .join('');
  if (!folded) return [];
  const found = new Set<JobFraudCategory>();
  for (const [category, re] of COMPILED) {
    if (re.test(folded)) found.add(category);
  }
  return JOB_FRAUD_CATEGORIES.filter((category) => found.has(category));
}

export function isJobFraudCategory(value: unknown): value is JobFraudCategory {
  return typeof value === 'string' && (JOB_FRAUD_CATEGORIES as readonly string[]).includes(value);
}
