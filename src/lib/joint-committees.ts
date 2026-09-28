/**
 * Słownik komisji parytetowych (PC/CP) — lustro tabeli `public.joint_committees` (migracja
 * 0169). Oferta zapisuje wyłącznie kod (`jobs.joint_committee`, FK do słownika), a nazwę
 * w języku strony bierze stąd — bez dodatkowego odczytu bazy na stronie ISR. Zgodność listy
 * z migracją pilnuje `tests/unit/job-costs.test.ts`; zmiana listy = nowa migracja.
 *
 * Nazwy NL/FR = oficjalne nazwy komisji (skrócone), PL/EN = opisowe tłumaczenia. Portal NIE
 * ocenia stawki względem minimum sektora — na szczególe oferty jest tylko kod, nazwa i link do
 * oficjalnej bazy stawek minimalnych FOD WASO / SPF ETCS.
 */
import type { Locale } from '@/i18n/routing';

export interface JointCommittee {
  code: string;
  names: Record<Locale, string>;
}

export const JOINT_COMMITTEES: readonly JointCommittee[] = [
  { code: '100', names: { pl: 'Pomocnicza komisja dla robotników', nl: 'Aanvullend paritair comité voor de werklieden', fr: 'Commission paritaire auxiliaire pour ouvriers', en: 'Auxiliary joint committee for blue-collar workers' } },
  { code: '111', names: { pl: 'Konstrukcje metalowe, mechaniczne i elektryczne', nl: 'Metaal-, machine- en elektrische bouw', fr: 'Constructions métallique, mécanique et électrique', en: 'Metal, mechanical and electrical engineering' } },
  { code: '112', names: { pl: 'Warsztaty samochodowe', nl: 'Garagebedrijf', fr: 'Entreprises de garage', en: 'Garages' } },
  { code: '116', names: { pl: 'Przemysł chemiczny (robotnicy)', nl: 'Scheikundige nijverheid', fr: 'Industrie chimique', en: 'Chemical industry (blue-collar)' } },
  { code: '118', names: { pl: 'Przemysł spożywczy (robotnicy)', nl: 'Voedingsnijverheid', fr: 'Industrie alimentaire', en: 'Food industry (blue-collar)' } },
  { code: '119', names: { pl: 'Handel artykułami spożywczymi', nl: 'Handel in voedingswaren', fr: 'Commerce alimentaire', en: 'Food trade' } },
  { code: '121', names: { pl: 'Sprzątanie', nl: 'Schoonmaak', fr: 'Nettoyage', en: 'Cleaning' } },
  { code: '124', names: { pl: 'Budownictwo', nl: 'Bouwbedrijf', fr: 'Construction', en: 'Construction' } },
  { code: '126', names: { pl: 'Meblarstwo i obróbka drewna', nl: 'Stoffering en houtbewerking', fr: 'Ameublement et industrie transformatrice du bois', en: 'Furniture and woodworking' } },
  { code: '130', names: { pl: 'Poligrafia', nl: 'Drukkerij, grafische kunst en dagbladbedrijf', fr: 'Imprimerie, arts graphiques et journaux', en: 'Printing and graphic arts' } },
  { code: '140', names: { pl: 'Transport i logistyka', nl: 'Vervoer en logistiek', fr: 'Transport et logistique', en: 'Transport and logistics' } },
  { code: '144', names: { pl: 'Rolnictwo', nl: 'Landbouw', fr: 'Agriculture', en: 'Agriculture' } },
  { code: '145', names: { pl: 'Ogrodnictwo', nl: 'Tuinbouw', fr: 'Entreprises horticoles', en: 'Horticulture' } },
  { code: '149.01', names: { pl: 'Elektrycy: instalacje i dystrybucja', nl: 'Elektriciens: installatie en distributie', fr: 'Électriciens: installation et distribution', en: 'Electricians: installation and distribution' } },
  { code: '200', names: { pl: 'Pomocnicza komisja dla pracowników umysłowych', nl: 'Aanvullend paritair comité voor de bedienden', fr: 'Commission paritaire auxiliaire pour employés', en: 'Auxiliary joint committee for white-collar workers' } },
  { code: '201', names: { pl: 'Niezależny handel detaliczny', nl: 'Zelfstandige kleinhandel', fr: 'Commerce de détail indépendant', en: 'Independent retail' } },
  { code: '202', names: { pl: 'Handel detaliczny artykułami spożywczymi (pracownicy umysłowi)', nl: 'Bedienden uit de kleinhandel in voedingswaren', fr: 'Employés du commerce de détail alimentaire', en: 'Food retail (white-collar)' } },
  { code: '220', names: { pl: 'Przemysł spożywczy (pracownicy umysłowi)', nl: 'Bedienden uit de voedingsnijverheid', fr: "Employés de l'industrie alimentaire", en: 'Food industry (white-collar)' } },
  { code: '226', names: { pl: 'Handel międzynarodowy, transport i logistyka (pracownicy umysłowi)', nl: 'Bedienden uit de internationale handel, het vervoer en de logistiek', fr: 'Employés du commerce international, du transport et de la logistique', en: 'International trade, transport and logistics (white-collar)' } },
  { code: '302', names: { pl: 'Hotelarstwo i gastronomia', nl: 'Hotelbedrijf', fr: 'Industrie hôtelière', en: 'Hotels and catering' } },
  { code: '311', names: { pl: 'Duże sklepy detaliczne', nl: 'Grote kleinhandelszaken', fr: 'Entreprises de vente au détail', en: 'Large retail stores' } },
  { code: '312', names: { pl: 'Domy towarowe', nl: 'Warenhuizen', fr: 'Grands magasins', en: 'Department stores' } },
  { code: '314', names: { pl: 'Fryzjerstwo i kosmetyka', nl: 'Kapsalons en schoonheidszorg', fr: 'Coiffure et soins de beauté', en: 'Hairdressing and beauty care' } },
  { code: '322', names: { pl: 'Praca tymczasowa (interim)', nl: 'Uitzendarbeid en erkende ondernemingen die buurtwerken of -diensten leveren', fr: 'Travail intérimaire et entreprises agréées fournissant des travaux ou services de proximité', en: 'Temporary agency work' } },
  { code: '322.01', names: { pl: 'Usługi w systemie czeków usługowych', nl: 'Erkende ondernemingen die buurtwerken of -diensten leveren (dienstencheques)', fr: 'Entreprises agréées fournissant des travaux ou services de proximité (titres-services)', en: 'Service voucher companies' } },
  { code: '330', names: { pl: 'Placówki i usługi opieki zdrowotnej', nl: 'Gezondheidsinrichtingen en -diensten', fr: 'Établissements et services de santé', en: 'Healthcare institutions and services' } },
];

const BY_CODE = new Map(JOINT_COMMITTEES.map((c) => [c.code, c]));

export const JOINT_COMMITTEE_CODES = JOINT_COMMITTEES.map((c) => c.code) as readonly string[];

export function findJointCommittee(code: string | null | undefined): JointCommittee | undefined {
  return code ? BY_CODE.get(code) : undefined;
}

/**
 * Oficjalna baza sektorowych stawek minimalnych (FOD WASO / SPF ETCS) — wersja FR dla strony
 * francuskiej, NL dla pozostałych. Ta sama baza, bez głębokiego linku per komisja (strona
 * nie ma stabilnych adresów komisji); kod komisji jest widoczny obok linku.
 */
export function minimumWagesUrl(locale: Locale): string {
  return locale === 'fr'
    ? 'https://www.salairesminimums.be/jc_overview.html'
    : 'https://www.minimumlonen.be/jc_overview.html';
}
