/**
 * ⚠️  DANE DEMONSTRACYJNE (fallback) — Pracuj.be
 * =============================================
 * Ten plik zawiera WYŁĄCZNIE fikcyjne, przykładowe dane ofert pracy, firm, kategorii
 * i lokalizacji. Nazwy firm, wynagrodzenia i opisy są zmyślone. Służą do renderowania
 * strony głównej i listy ofert, gdy baza NIE jest skonfigurowana
 * (tryb demo — patrz `isDatabaseConfigured()` w `@/lib/env`).
 *
 * Miasta i regiony są prawdziwe (belgijskie), reszta treści jest demonstracyjna.
 *
 * Treść jest w pełni wielojęzyczna (pl/nl/fr/en) — tekst każdej oferty składany jest
 * z lokalizowanych bloków, dzięki czemu `resolveDemoJobs(locale)` zwraca ofertę w języku
 * użytkownika. Eksport `demoJobs` to gotowa lista `JobDetail[]` w domyślnym języku.
 */

import type {
  CategoryKey,
  ContractType,
  JobDetail,
  JobListItem,
  LocationKey,
  SalaryPeriod,
} from '@/lib/jobs';
import { routing, type Locale } from '@/i18n/routing';

/** Wartość lokalizowana na wszystkie języki aplikacji. */
type L<T = string> = Record<Locale, T>;

const CURRENCY = 'EUR';
/** Oferta oznaczona jako „nowa”, jeśli opublikowana w ciągu tylu dni. */
const NEW_DAYS = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Punkt odniesienia dla dat — ustalany raz przy załadowaniu modułu (demo => daty względne). */
const NOW_MS = Date.now();

/* ---------------------------------------------------------------------------
 * Słowniki lokalizacyjne (wielokrotnego użytku)
 * ------------------------------------------------------------------------- */

/** Nazwy zawodów (podstawa tytułu oferty). Klucz = identyfikator zawodu. */
const OCCUPATION = {
  warehouseWorker: { pl: 'Magazynier', nl: 'Magazijnmedewerker', fr: 'Magasinier', en: 'Warehouse worker' },
  bricklayer: { pl: 'Murarz', nl: 'Metselaar', fr: 'Maçon', en: 'Bricklayer' },
  truckDriver: { pl: 'Kierowca C+E', nl: 'Vrachtwagenchauffeur (C+E)', fr: 'Chauffeur poids lourd (C+E)', en: 'Truck driver (C+E)' },
  cleaner: { pl: 'Osoba sprzątająca', nl: 'Schoonmaker', fr: "Agent d'entretien", en: 'Office cleaner' },
  productionOperator: { pl: 'Operator produkcji', nl: 'Productiemedewerker', fr: 'Opérateur de production', en: 'Production operator' },
  welder: { pl: 'Spawacz MIG/MAG', nl: 'Lasser (MIG/MAG)', fr: 'Soudeur (MIG/MAG)', en: 'Welder (MIG/MAG)' },
  forkliftOperator: { pl: 'Operator wózka widłowego', nl: 'Heftruckchauffeur', fr: 'Cariste', en: 'Forklift operator' },
  kitchenAssistant: { pl: 'Pomoc kuchenna', nl: 'Keukenhulp', fr: 'Aide de cuisine', en: 'Kitchen assistant' },
  careAssistant: { pl: 'Opiekun/ka', nl: 'Zorgkundige', fr: 'Aide-soignant(e)', en: 'Care assistant' },
  electrician: { pl: 'Elektryk', nl: 'Elektricien', fr: 'Électricien', en: 'Electrician' },
  fruitPicker: { pl: 'Zbieracz owoców', nl: 'Fruitplukker', fr: 'Cueilleur de fruits', en: 'Fruit picker' },
  painter: { pl: 'Malarz', nl: 'Schilder', fr: 'Peintre', en: 'Painter' },
  carpenter: { pl: 'Cieśla', nl: 'Timmerman', fr: 'Charpentier', en: 'Carpenter' },
  orderPicker: { pl: 'Kompletator zamówień', nl: 'Orderpicker', fr: 'Préparateur de commandes', en: 'Order picker' },
  cncOperator: { pl: 'Operator CNC', nl: 'CNC-operator', fr: 'Opérateur CNC', en: 'CNC operator' },
  deliveryDriver: { pl: 'Kierowca dostawczy (kat. B)', nl: 'Bestelwagenchauffeur (B)', fr: 'Chauffeur-livreur (B)', en: 'Delivery driver (B)' },
  hotelHousekeeper: { pl: 'Pokojowa / Pokojowy', nl: 'Kamermeisje / -jongen', fr: 'Femme / valet de chambre', en: 'Hotel housekeeper' },
  plumber: { pl: 'Hydraulik', nl: 'Loodgieter', fr: 'Plombier', en: 'Plumber' },
  logisticsCoordinator: { pl: 'Koordynator logistyki', nl: 'Logistiek coördinator', fr: 'Coordinateur logistique', en: 'Logistics coordinator' },
  dishwasher: { pl: 'Pomoc w zmywaku', nl: 'Afwasser', fr: 'Plongeur', en: 'Dishwasher' },
  elderlyCareAide: { pl: 'Opiekun osób starszych', nl: 'Verzorgende ouderenzorg', fr: 'Aide aux personnes âgées', en: 'Elderly care aide' },
  scaffolder: { pl: 'Monter rusztowań', nl: 'Steigerbouwer', fr: "Monteur d'échafaudages", en: 'Scaffolder' },
  machineOperator: { pl: 'Operator maszyn', nl: 'Machineoperator', fr: 'Opérateur machine', en: 'Machine operator' },
  warehouseSupervisor: { pl: 'Brygadzista magazynu', nl: 'Magazijnverantwoordelijke', fr: "Chef d'équipe entrepôt", en: 'Warehouse supervisor' },
  gardener: { pl: 'Ogrodnik', nl: 'Tuinman', fr: 'Jardinier', en: 'Gardener' },
  logisticsIntern: { pl: 'Stażysta ds. logistyki', nl: 'Stagiair logistiek', fr: 'Stagiaire logistique', en: 'Logistics intern' },
} satisfies Record<string, L>;

type OccKey = keyof typeof OCCUPATION;

/** Bezdiakrytyczne tokeny do slugów (format 'stanowisko-miasto-ID'). */
const OCC_SLUG = {
  warehouseWorker: 'warehouse-worker',
  bricklayer: 'bricklayer',
  truckDriver: 'truck-driver',
  cleaner: 'office-cleaner',
  productionOperator: 'production-operator',
  welder: 'welder',
  forkliftOperator: 'forklift-operator',
  kitchenAssistant: 'kitchen-assistant',
  careAssistant: 'care-assistant',
  electrician: 'electrician',
  fruitPicker: 'fruit-picker',
  painter: 'painter',
  carpenter: 'carpenter',
  orderPicker: 'order-picker',
  cncOperator: 'cnc-operator',
  deliveryDriver: 'delivery-driver',
  hotelHousekeeper: 'hotel-housekeeper',
  plumber: 'plumber',
  logisticsCoordinator: 'logistics-coordinator',
  dishwasher: 'dishwasher',
  elderlyCareAide: 'elderly-care-aide',
  scaffolder: 'scaffolder',
  machineOperator: 'machine-operator',
  warehouseSupervisor: 'warehouse-supervisor',
  gardener: 'gardener',
  logisticsIntern: 'logistics-intern',
} satisfies Record<OccKey, string>;

/** Prawdziwe belgijskie miasta (nazwy lokalizowane). */
const CITY = {
  brussels: { pl: 'Bruksela', nl: 'Brussel', fr: 'Bruxelles', en: 'Brussels' },
  antwerp: { pl: 'Antwerpia', nl: 'Antwerpen', fr: 'Anvers', en: 'Antwerp' },
  ghent: { pl: 'Gandawa', nl: 'Gent', fr: 'Gand', en: 'Ghent' },
  leuven: { pl: 'Leuven', nl: 'Leuven', fr: 'Louvain', en: 'Leuven' },
  mechelen: { pl: 'Mechelen', nl: 'Mechelen', fr: 'Malines', en: 'Mechelen' },
  hasselt: { pl: 'Hasselt', nl: 'Hasselt', fr: 'Hasselt', en: 'Hasselt' },
  liege: { pl: 'Liège', nl: 'Luik', fr: 'Liège', en: 'Liège' },
  charleroi: { pl: 'Charleroi', nl: 'Charleroi', fr: 'Charleroi', en: 'Charleroi' },
  bruges: { pl: 'Brugia', nl: 'Brugge', fr: 'Bruges', en: 'Bruges' },
  kortrijk: { pl: 'Kortrijk', nl: 'Kortrijk', fr: 'Courtrai', en: 'Kortrijk' },
} satisfies Record<LocationKey, L>;

/** Prawdziwe belgijskie regiony/prowincje (nazwy lokalizowane). */
const REGION = {
  brusselsCap: { pl: 'Region Stołeczny Brukseli', nl: 'Brussels Hoofdstedelijk Gewest', fr: 'Région de Bruxelles-Capitale', en: 'Brussels-Capital Region' },
  antwerpProv: { pl: 'Prowincja Antwerpia', nl: 'Provincie Antwerpen', fr: "Province d'Anvers", en: 'Antwerp Province' },
  eastFlanders: { pl: 'Flandria Wschodnia', nl: 'Oost-Vlaanderen', fr: 'Flandre-Orientale', en: 'East Flanders' },
  westFlanders: { pl: 'Flandria Zachodnia', nl: 'West-Vlaanderen', fr: 'Flandre-Occidentale', en: 'West Flanders' },
  flemishBrabant: { pl: 'Brabancja Flamandzka', nl: 'Vlaams-Brabant', fr: 'Brabant flamand', en: 'Flemish Brabant' },
  limburg: { pl: 'Limburgia', nl: 'Limburg', fr: 'Limbourg', en: 'Limburg' },
  liegeProv: { pl: 'Prowincja Liège', nl: 'Provincie Luik', fr: 'Province de Liège', en: 'Liège Province' },
  hainaut: { pl: 'Hainaut', nl: 'Henegouwen', fr: 'Hainaut', en: 'Hainaut' },
} satisfies Record<string, L>;

type RegionKey = keyof typeof REGION;

const REGION_OF = {
  brussels: 'brusselsCap',
  antwerp: 'antwerpProv',
  ghent: 'eastFlanders',
  leuven: 'flemishBrabant',
  mechelen: 'antwerpProv',
  hasselt: 'limburg',
  liege: 'liegeProv',
  charleroi: 'hainaut',
  bruges: 'westFlanders',
  kortrijk: 'westFlanders',
} satisfies Record<LocationKey, RegionKey>;

/** Nazwy języków (do listy wymaganych języków oferty). */
const LANG = {
  pl: { pl: 'polski', nl: 'Pools', fr: 'polonais', en: 'Polish' },
  nl: { pl: 'niderlandzki', nl: 'Nederlands', fr: 'néerlandais', en: 'Dutch' },
  fr: { pl: 'francuski', nl: 'Frans', fr: 'français', en: 'French' },
  en: { pl: 'angielski', nl: 'Engels', fr: 'anglais', en: 'English' },
  de: { pl: 'niemiecki', nl: 'Duits', fr: 'allemand', en: 'German' },
} satisfies Record<string, L>;

type LangKey = keyof typeof LANG;

/** Szablon pierwszego zdania opisu (z podstawieniami {company}/{role}/{city}). */
const LEAD: L = {
  pl: '{company} poszukuje pracownika na stanowisko: {role} w lokalizacji {city}.',
  nl: '{company} zoekt een {role} in {city}.',
  fr: '{company} recherche un(e) {role} à {city}.',
  en: '{company} is looking for a {role} in {city}.',
};

/** Zdania „kontekstowe” dopisywane do opisu. */
const CTX = {
  stable: {
    pl: 'To stabilne zatrudnienie z myślą o długiej współpracy.',
    nl: 'Dit is een stabiele functie met een langetermijnvisie.',
    fr: "Il s'agit d'un poste stable, dans une optique de long terme.",
    en: 'This is a stable position with a long-term outlook.',
  },
  team: {
    pl: 'Dołączysz do zgranego, doświadczonego zespołu.',
    nl: 'Je komt terecht in een hecht en ervaren team.',
    fr: 'Vous rejoindrez une équipe soudée et expérimentée.',
    en: 'You will join a close-knit, experienced team.',
  },
  growth: {
    pl: 'Oferujemy realne możliwości rozwoju i szkolenia.',
    nl: 'Er zijn echte doorgroei- en opleidingsmogelijkheden.',
    fr: "De réelles possibilités d'évolution et de formation sont offertes.",
    en: 'There are real opportunities to grow and train.',
  },
  immediate: {
    pl: 'Możesz zacząć od zaraz.',
    nl: 'Je kan onmiddellijk starten.',
    fr: 'Vous pouvez commencer immédiatement.',
    en: 'You can start immediately.',
  },
  accommodation: {
    pl: 'Zapewniamy pomoc w znalezieniu zakwaterowania.',
    nl: 'Wij helpen bij het vinden van huisvesting.',
    fr: 'Nous aidons à trouver un logement.',
    en: 'We help you find accommodation.',
  },
  noLang: {
    pl: 'Znajomość niderlandzkiego ani francuskiego nie jest wymagana.',
    nl: 'Kennis van het Nederlands of Frans is niet vereist.',
    fr: "La connaissance du néerlandais ou du français n'est pas requise.",
    en: 'No knowledge of Dutch or French is required.',
  },
  seasonal: {
    pl: 'To praca sezonowa na miesiące letnie.',
    nl: 'Dit is seizoenswerk voor de zomermaanden.',
    fr: "Il s'agit d'un travail saisonnier pour les mois d'été.",
    en: 'This is seasonal work for the summer months.',
  },
} satisfies Record<string, L>;

type CtxKey = keyof typeof CTX;

/** Zakres obowiązków. */
const RESP = {
  loadUnload: { pl: 'Załadunek i rozładunek towaru', nl: 'Laden en lossen van goederen', fr: 'Chargement et déchargement des marchandises', en: 'Loading and unloading goods' },
  orderPick: { pl: 'Kompletowanie i pakowanie zamówień', nl: 'Orders verzamelen en verpakken', fr: 'Préparation et emballage des commandes', en: 'Picking and packing orders' },
  forklift: { pl: 'Obsługa wózka widłowego', nl: 'Bedienen van de heftruck', fr: 'Conduite du chariot élévateur', en: 'Operating a forklift' },
  stock: { pl: 'Prowadzenie ewidencji magazynowej', nl: 'Bijhouden van de voorraadadministratie', fr: 'Tenue des stocks', en: 'Keeping stock records' },
  masonry: { pl: 'Prace murarskie i tynkarskie', nl: 'Metsel- en pleisterwerk', fr: "Travaux de maçonnerie et d'enduit", en: 'Bricklaying and plastering' },
  readPlans: { pl: 'Praca według rysunków technicznych', nl: 'Werken volgens technische tekeningen', fr: "Travail d'après plans techniques", en: 'Working from technical drawings' },
  site: { pl: 'Utrzymanie porządku i bezpieczeństwa na budowie', nl: 'Netheid en veiligheid op de werf', fr: 'Propreté et sécurité sur le chantier', en: 'Keeping the site clean and safe' },
  drive: { pl: 'Realizacja tras dostaw', nl: 'Rijden van geplande ritten', fr: 'Réalisation des tournées de livraison', en: 'Driving planned delivery routes' },
  vehicleCheck: { pl: 'Codzienna kontrola stanu pojazdu', nl: 'Dagelijkse controle van het voertuig', fr: 'Contrôle quotidien du véhicule', en: 'Daily vehicle checks' },
  clean: { pl: 'Sprzątanie pomieszczeń i części wspólnych', nl: 'Schoonmaken van ruimtes en gemeenschappelijke delen', fr: 'Nettoyage des locaux et parties communes', en: 'Cleaning rooms and common areas' },
  supplies: { pl: 'Uzupełnianie środków czystości', nl: 'Aanvullen van schoonmaakmiddelen', fr: "Réapprovisionnement des produits d'entretien", en: 'Restocking cleaning supplies' },
  machine: { pl: 'Obsługa maszyn produkcyjnych', nl: 'Bedienen van productiemachines', fr: 'Conduite des machines de production', en: 'Operating production machinery' },
  quality: { pl: 'Kontrola jakości produktów', nl: 'Kwaliteitscontrole van producten', fr: 'Contrôle qualité des produits', en: 'Checking product quality' },
  weld: { pl: 'Spawanie elementów stalowych', nl: 'Lassen van stalen onderdelen', fr: "Soudure de pièces en acier", en: 'Welding steel components' },
  assemble: { pl: 'Montaż podzespołów na linii', nl: 'Assembleren van onderdelen aan de lijn', fr: 'Assemblage de pièces sur la ligne', en: 'Assembling parts on the line' },
  electric: { pl: 'Montaż instalacji elektrycznych', nl: 'Installeren van elektrische systemen', fr: 'Installation de systèmes électriques', en: 'Installing electrical systems' },
  prepFood: { pl: 'Przygotowywanie składników do serwisu', nl: 'Voorbereiden van ingrediënten', fr: 'Préparation des ingrédients', en: 'Preparing ingredients for service' },
  dishes: { pl: 'Zmywanie naczyń i sprzętu kuchennego', nl: 'Afwassen van vaat en keukengerei', fr: 'Plonge et nettoyage du matériel', en: 'Washing dishes and kitchenware' },
  careDaily: { pl: 'Pomoc podopiecznym w codziennych czynnościach', nl: 'Bewoners helpen bij dagelijkse activiteiten', fr: 'Aide aux résidents dans les gestes quotidiens', en: 'Helping residents with daily activities' },
  careHygiene: { pl: 'Wsparcie w higienie i poruszaniu się', nl: 'Ondersteuning bij hygiëne en mobiliteit', fr: "Aide à l'hygiène et à la mobilité", en: 'Support with hygiene and mobility' },
  careCompany: { pl: 'Zapewnianie towarzystwa i wsparcia', nl: 'Gezelschap en ondersteuning bieden', fr: 'Offrir compagnie et soutien', en: 'Providing company and support' },
  paint: { pl: 'Malowanie ścian i powierzchni', nl: 'Schilderen van muren en oppervlakken', fr: 'Peinture des murs et surfaces', en: 'Painting walls and surfaces' },
  carpentry: { pl: 'Docinanie i montaż elementów drewnianych', nl: 'Zagen en plaatsen van houtwerk', fr: 'Découpe et pose de boiseries', en: 'Cutting and fitting woodwork' },
  cnc: { pl: 'Ustawianie i obsługa maszyn CNC', nl: 'Instellen en bedienen van CNC-machines', fr: 'Réglage et conduite de machines CNC', en: 'Setting up and running CNC machines' },
  planLogistics: { pl: 'Koordynacja dziennego planu logistycznego', nl: 'Coördineren van het dagelijkse logistieke plan', fr: 'Coordination du plan logistique quotidien', en: 'Coordinating the daily logistics plan' },
  lead: { pl: 'Kierowanie małym zespołem magazynu', nl: 'Aansturen van een klein magazijnteam', fr: "Encadrement d'une petite équipe d'entrepôt", en: 'Leading a small warehouse team' },
  harvest: { pl: 'Zbiór owoców i warzyw', nl: 'Oogsten van fruit en groenten', fr: 'Récolte de fruits et légumes', en: 'Harvesting fruit and vegetables' },
  garden: { pl: 'Pielęgnacja ogrodów i terenów zielonych', nl: 'Onderhoud van tuinen en groenzones', fr: 'Entretien des jardins et espaces verts', en: 'Maintaining gardens and green areas' },
  scaffold: { pl: 'Montaż i demontaż rusztowań', nl: 'Op- en afbouwen van steigers', fr: "Montage et démontage d'échafaudages", en: 'Assembling and dismantling scaffolding' },
  plumbingInstall: { pl: 'Montaż i naprawa instalacji sanitarnych', nl: 'Installeren en herstellen van sanitair', fr: 'Installation et réparation de plomberie', en: 'Installing and repairing plumbing' },
  serveGuests: { pl: 'Przygotowanie pokoi dla gości', nl: 'Klaarmaken van kamers voor gasten', fr: 'Préparation des chambres pour les clients', en: 'Preparing rooms for guests' },
} satisfies Record<string, L>;

type RespKey = keyof typeof RESP;

/** Wymagania obowiązkowe. */
const MAND = {
  physical: { pl: 'Dobra kondycja fizyczna', nl: 'Goede fysieke conditie', fr: 'Bonne condition physique', en: 'Good physical condition' },
  reliable: { pl: 'Rzetelność i punktualność', nl: 'Betrouwbaarheid en stiptheid', fr: 'Fiabilité et ponctualité', en: 'Reliability and punctuality' },
  teamwork: { pl: 'Umiejętność pracy w zespole', nl: 'Kunnen samenwerken in team', fr: "Esprit d'équipe", en: 'Ability to work in a team' },
  experience: { pl: 'Doświadczenie na podobnym stanowisku', nl: 'Ervaring in een gelijkaardige functie', fr: 'Expérience à un poste similaire', en: 'Experience in a similar role' },
  licenseB: { pl: 'Prawo jazdy kat. B', nl: 'Rijbewijs B', fr: 'Permis B', en: 'Driving licence B' },
  licenseCE: { pl: 'Prawo jazdy kat. C+E oraz kod 95', nl: 'Rijbewijs C+E en code 95', fr: 'Permis C+E et code 95', en: 'C+E licence and code 95' },
  forkliftCert: { pl: 'Uprawnienia na wózki widłowe', nl: 'Heftruckcertificaat', fr: 'Certificat de cariste', en: 'Forklift certificate' },
  dutch: { pl: 'Komunikatywny niderlandzki', nl: 'Communicatief Nederlands', fr: 'Néerlandais courant', en: 'Conversational Dutch' },
  french: { pl: 'Komunikatywny francuski', nl: 'Communicatief Frans', fr: 'Français courant', en: 'Conversational French' },
  english: { pl: 'Komunikatywny angielski', nl: 'Communicatief Engels', fr: 'Anglais courant', en: 'Conversational English' },
  weldCert: { pl: 'Certyfikat spawacza MIG/MAG', nl: 'Lascertificaat MIG/MAG', fr: 'Certificat de soudeur MIG/MAG', en: 'MIG/MAG welding certificate' },
  vcaSafety: { pl: 'Certyfikat VCA (BHP)', nl: 'VCA-attest', fr: 'Certificat VCA (sécurité)', en: 'VCA safety certificate' },
  availableShifts: { pl: 'Gotowość do pracy zmianowej', nl: 'Bereid tot ploegenwerk', fr: "Disponibilité pour le travail en équipes", en: 'Willingness to work shifts' },
  ownTransport: { pl: 'Własny transport do pracy', nl: 'Eigen vervoer naar het werk', fr: 'Moyen de transport personnel', en: 'Own transport to work' },
  workPermit: { pl: 'Prawo do pracy w Belgii', nl: 'Recht om in België te werken', fr: 'Droit de travailler en Belgique', en: 'Right to work in Belgium' },
  diploma: { pl: 'Dyplom w odpowiednim zawodzie', nl: 'Diploma in het vakgebied', fr: 'Diplôme dans le métier', en: 'Diploma in the trade' },
  precise: { pl: 'Dokładność i dbałość o szczegóły', nl: 'Nauwkeurig en oog voor detail', fr: 'Précision et souci du détail', en: 'Accuracy and attention to detail' },
  hygiene: { pl: 'Przestrzeganie zasad higieny', nl: 'Respecteren van hygiënevoorschriften', fr: "Respect des règles d'hygiène", en: 'Respect of hygiene rules' },
  empathy: { pl: 'Empatia i cierpliwość', nl: 'Empathie en geduld', fr: 'Empathie et patience', en: 'Empathy and patience' },
  student: { pl: 'Status studenta', nl: 'Studentenstatuut', fr: "Statut d'étudiant", en: 'Student status' },
} satisfies Record<string, L>;

type MandKey = keyof typeof MAND;

/** Wymagania mile widziane. */
const OPT = {
  langBonus: { pl: 'Znajomość dodatkowego języka mile widziana', nl: 'Kennis van een extra taal is een plus', fr: "La connaissance d'une langue supplémentaire est un atout", en: 'An extra language is a plus' },
  forklift: { pl: 'Uprawnienia na wózek widłowy atutem', nl: 'Heftruckcertificaat is een plus', fr: 'Le certificat de cariste est un atout', en: 'Forklift certificate is a plus' },
  experienceBonus: { pl: 'Doświadczenie w branży atutem', nl: 'Ervaring in de sector is een plus', fr: 'Une expérience dans le secteur est un atout', en: 'Sector experience is a plus' },
  ownCar: { pl: 'Własny samochód atutem', nl: 'Eigen wagen is een plus', fr: 'Voiture personnelle est un atout', en: 'Own car is a plus' },
  flexible: { pl: 'Elastyczność godzinowa atutem', nl: 'Flexibiliteit qua uren is een plus', fr: 'La flexibilité horaire est un atout', en: 'Flexible hours are a plus' },
  vca: { pl: 'Certyfikat VCA atutem', nl: 'VCA-attest is een plus', fr: 'Le certificat VCA est un atout', en: 'VCA certificate is a plus' },
  computer: { pl: 'Podstawowa obsługa komputera', nl: 'Basiskennis computer', fr: "Notions d'informatique", en: 'Basic computer skills' },
  leadership: { pl: 'Doświadczenie w kierowaniu zespołem', nl: 'Ervaring met leidinggeven', fr: "Expérience en gestion d'équipe", en: 'Team leadership experience' },
  dutchBonus: { pl: 'Podstawy niderlandzkiego atutem', nl: 'Basis Nederlands is een plus', fr: 'Des bases en néerlandais sont un atout', en: 'Basic Dutch is a plus' },
  frenchBonus: { pl: 'Podstawy francuskiego atutem', nl: 'Basis Frans is een plus', fr: 'Des bases en français sont un atout', en: 'Basic French is a plus' },
  hospitalityExp: { pl: 'Doświadczenie w gastronomii atutem', nl: 'Horeca-ervaring is een plus', fr: 'Une expérience en horeca est un atout', en: 'Hospitality experience is a plus' },
  longTerm: { pl: 'Chęć długoterminowej współpracy', nl: 'Interesse in een langdurige samenwerking', fr: 'Intérêt pour une collaboration à long terme', en: 'Interest in a long-term collaboration' },
} satisfies Record<string, L>;

type OptKey = keyof typeof OPT;

/** Warunki zatrudnienia / benefity. */
const COND = {
  weekly: { pl: 'Wypłata tygodniowa lub miesięczna', nl: 'Wekelijkse of maandelijkse uitbetaling', fr: 'Paiement hebdomadaire ou mensuel', en: 'Weekly or monthly pay' },
  mealVouchers: { pl: 'Bony żywnościowe', nl: 'Maaltijdcheques', fr: 'Chèques-repas', en: 'Meal vouchers' },
  travel: { pl: 'Zwrot kosztów dojazdu', nl: 'Vergoeding voor woon-werkverkeer', fr: 'Indemnité de déplacement', en: 'Travel allowance' },
  accommodation: { pl: 'Pomoc w zakwaterowaniu', nl: 'Hulp bij huisvesting', fr: 'Aide au logement', en: 'Help with accommodation' },
  longTerm: { pl: 'Perspektywa stałej umowy', nl: 'Uitzicht op een vast contract', fr: 'Perspective de contrat fixe', en: 'Prospect of a permanent contract' },
  training: { pl: 'Szkolenia wprowadzające', nl: 'Opleiding voorzien', fr: 'Formation assurée', en: 'Training provided' },
  ppe: { pl: 'Odzież robocza i środki ochrony', nl: 'Werkkledij en beschermingsmiddelen', fr: 'Vêtements et équipements de protection', en: 'Work clothing and protective equipment' },
  bonus: { pl: 'Premie za wydajność', nl: 'Productiviteitspremies', fr: 'Primes de productivité', en: 'Performance bonuses' },
  holiday: { pl: 'Dodatek urlopowy i 13. pensja', nl: 'Vakantiegeld en eindejaarspremie', fr: 'Pécule de vacances et prime de fin d\'année', en: 'Holiday pay and 13th month' },
  stableHours: { pl: 'Stałe godziny pracy', nl: 'Vaste werkuren', fr: 'Horaires fixes', en: 'Stable working hours' },
  youngTeam: { pl: 'Miła atmosfera w zespole', nl: 'Aangename teamsfeer', fr: "Bonne ambiance d'équipe", en: 'Friendly team atmosphere' },
  growth: { pl: 'Możliwości awansu', nl: 'Doorgroeimogelijkheden', fr: "Possibilités d'évolution", en: 'Career growth opportunities' },
} satisfies Record<string, L>;

type CondKey = keyof typeof COND;

/** Krótkie „chipy” wyróżnień pokazywane na kartach ofert. */
const HL = {
  immediate: { pl: 'Start od zaraz', nl: 'Onmiddellijke start', fr: 'Début immédiat', en: 'Immediate start' },
  accommodation: { pl: 'Zakwaterowanie', nl: 'Huisvesting', fr: 'Logement', en: 'Accommodation' },
  noLang: { pl: 'Bez znajomości języka', nl: 'Geen taalkennis nodig', fr: 'Sans exigence de langue', en: 'No language required' },
  weeklyPay: { pl: 'Wypłata co tydzień', nl: 'Wekelijks loon', fr: 'Paie hebdomadaire', en: 'Weekly pay' },
  permanent: { pl: 'Umowa na stałe', nl: 'Vast contract', fr: 'Contrat fixe', en: 'Permanent contract' },
  mealVouchers: { pl: 'Bony żywnościowe', nl: 'Maaltijdcheques', fr: 'Chèques-repas', en: 'Meal vouchers' },
  travel: { pl: 'Zwrot dojazdu', nl: 'Vervoersvergoeding', fr: 'Frais de route', en: 'Travel covered' },
  training: { pl: 'Szkolenia', nl: 'Opleiding', fr: 'Formation', en: 'Training' },
  transport: { pl: 'Dojazd zapewniony', nl: 'Vervoer voorzien', fr: 'Transport assuré', en: 'Transport provided' },
  bonus: { pl: 'Premie', nl: 'Premies', fr: 'Primes', en: 'Bonuses' },
  flexible: { pl: 'Elastyczne godziny', nl: 'Flexibele uren', fr: 'Horaires flexibles', en: 'Flexible hours' },
  seasonal: { pl: 'Praca sezonowa', nl: 'Seizoenswerk', fr: 'Travail saisonnier', en: 'Seasonal work' },
  student: { pl: 'Praca dla studenta', nl: 'Studentenjob', fr: 'Job étudiant', en: 'Student job' },
  teamLead: { pl: 'Rola kierownicza', nl: 'Leidinggevende rol', fr: "Rôle d'encadrement", en: 'Leadership role' },
} satisfies Record<string, L>;

type HlKey = keyof typeof HL;

/** Wymiar czasu pracy. */
const WH = {
  fulltime: { pl: 'Pełny etat, 38 godz./tydzień', nl: 'Voltijds, 38 uur/week', fr: 'Temps plein, 38 h/semaine', en: 'Full-time, 38 hrs/week' },
  fulltime40: { pl: 'Pełny etat, 40 godz./tydzień', nl: 'Voltijds, 40 uur/week', fr: 'Temps plein, 40 h/semaine', en: 'Full-time, 40 hrs/week' },
  parttime: { pl: 'Niepełny etat, 20-30 godz./tydzień', nl: 'Deeltijds, 20-30 uur/week', fr: 'Temps partiel, 20-30 h/semaine', en: 'Part-time, 20-30 hrs/week' },
  dayShift: { pl: 'Praca w dzień, pon.-pt.', nl: 'Dagwerk, ma-vr', fr: 'Travail de jour, lun.-ven.', en: 'Day work, Mon-Fri' },
  flexible: { pl: 'Elastyczny grafik', nl: 'Flexibel uurrooster', fr: 'Horaire flexible', en: 'Flexible schedule' },
  seasonal: { pl: 'Pełny etat w sezonie', nl: 'Voltijds tijdens het seizoen', fr: 'Temps plein en saison', en: 'Full-time during the season' },
} satisfies Record<string, L>;

type WhKey = keyof typeof WH;

/** System zmianowy. */
const SH = {
  two: { pl: 'System dwuzmianowy', nl: 'Twee ploegen', fr: 'Deux équipes', en: 'Two shifts' },
  three: { pl: 'System trzyzmianowy', nl: 'Drie ploegen', fr: 'Trois équipes', en: 'Three shifts' },
  day: { pl: 'Tylko dzienna zmiana', nl: 'Enkel dagploeg', fr: 'Équipe de jour uniquement', en: 'Day shift only' },
  earlyLate: { pl: 'Zmiany ranne i popołudniowe', nl: 'Vroege en late shift', fr: "Équipes du matin et de l'après-midi", en: 'Early and late shifts' },
  weekend: { pl: 'Praca także w weekendy', nl: 'Ook weekendwerk', fr: 'Travail aussi le week-end', en: 'Weekend work included' },
} satisfies Record<string, L>;

type ShKey = keyof typeof SH;

/* ---------------------------------------------------------------------------
 * Firmy (demonstracyjne)
 * ------------------------------------------------------------------------- */

export interface DemoCompany {
  id: string;
  /** Nazwa marki (nie tłumaczona). */
  name: string;
  verified: boolean;
  locationKey: LocationKey;
  /** Opis firmy — lokalizowany. */
  description: L;
}

const COMPANY_MAP = {
  c1: {
    id: 'c1',
    name: 'Antwerp Logistics NV',
    verified: true,
    locationKey: 'antwerp',
    description: {
      pl: 'Antwerp Logistics NV prowadzi jedno z największych centrów dystrybucji w porcie w Antwerpii, obsługując klientów z całej Europy.',
      nl: 'Antwerp Logistics NV baat een van de grootste distributiecentra in de haven van Antwerpen uit en werkt voor klanten in heel Europa.',
      fr: "Antwerp Logistics NV exploite l'un des plus grands centres de distribution du port d'Anvers, au service de clients dans toute l'Europe.",
      en: 'Antwerp Logistics NV runs one of the largest distribution hubs in the Port of Antwerp, handling goods for clients across Europe.',
    },
  },
  c2: {
    id: 'c2',
    name: 'Brussels Build SA',
    verified: true,
    locationKey: 'brussels',
    description: {
      pl: 'Brussels Build SA to firma generalnego wykonawstwa realizująca projekty mieszkaniowe i komercyjne w Brukseli i Walonii.',
      nl: 'Brussels Build SA is een algemene aannemer die woon- en commerciële projecten realiseert in Brussel en Wallonië.',
      fr: 'Brussels Build SA est une entreprise générale qui réalise des projets résidentiels et commerciaux à Bruxelles et en Wallonie.',
      en: 'Brussels Build SA is a general contractor delivering residential and commercial projects across Brussels and Wallonia.',
    },
  },
  c3: {
    id: 'c3',
    name: 'Flanders Transport BV',
    verified: true,
    locationKey: 'ghent',
    description: {
      pl: 'Flanders Transport BV to rodzinna firma transportowa dysponująca nowoczesną flotą na terenie Beneluksu.',
      nl: 'Flanders Transport BV is een familiaal transportbedrijf met een moderne vloot in de Benelux.',
      fr: 'Flanders Transport BV est une entreprise familiale de transport disposant d\'une flotte moderne dans le Benelux.',
      en: 'Flanders Transport BV is a family transport company operating a modern fleet across the Benelux.',
    },
  },
  c4: {
    id: 'c4',
    name: 'CleanPro Services',
    verified: false,
    locationKey: 'brussels',
    description: {
      pl: 'CleanPro Services świadczy profesjonalne usługi sprzątania i utrzymania czystości dla biur i hoteli w regionie Brukseli.',
      nl: 'CleanPro Services levert professionele schoonmaak en housekeeping voor kantoren en hotels in de regio Brussel.',
      fr: 'CleanPro Services propose des services professionnels de nettoyage et d\'entretien pour bureaux et hôtels dans la région bruxelloise.',
      en: 'CleanPro Services provides professional cleaning and housekeeping for offices and hotels in the Brussels region.',
    },
  },
  c5: {
    id: 'c5',
    name: 'Limburg Production NV',
    verified: true,
    locationKey: 'hasselt',
    description: {
      pl: 'Limburg Production NV produkuje opakowania dla przemysłu spożywczego w zakładzie w Hasselt.',
      nl: 'Limburg Production NV produceert verpakkingen voor de voedingsindustrie in de vestiging in Hasselt.',
      fr: 'Limburg Production NV fabrique des emballages pour l\'industrie alimentaire dans son usine de Hasselt.',
      en: 'Limburg Production NV manufactures packaging for the food industry at its plant in Hasselt.',
    },
  },
  c6: {
    id: 'c6',
    name: 'MetalWorks Antwerpen',
    verified: true,
    locationKey: 'antwerp',
    description: {
      pl: 'MetalWorks Antwerpen specjalizuje się w konstrukcjach metalowych i instalacjach przemysłowych dla sektora petrochemicznego.',
      nl: 'MetalWorks Antwerpen is gespecialiseerd in metaalconstructie en industriële installaties voor de petrochemie.',
      fr: 'MetalWorks Antwerpen est spécialisée dans la construction métallique et les installations industrielles pour le secteur pétrochimique.',
      en: 'MetalWorks Antwerpen specialises in metal construction and industrial installations for the petrochemical sector.',
    },
  },
  c7: {
    id: 'c7',
    name: 'PortLog Gent',
    verified: true,
    locationKey: 'ghent',
    description: {
      pl: 'PortLog Gent oferuje usługi magazynowania i realizacji zamówień ze swojej lokalizacji w porcie w Gandawie.',
      nl: 'PortLog Gent biedt magazijn- en orderafhandelingsdiensten aan vanuit zijn site in het Gentse havengebied.',
      fr: 'PortLog Gent propose des services d\'entreposage et de préparation de commandes depuis son site dans la zone portuaire de Gand.',
      en: 'PortLog Gent offers warehousing and order-fulfilment services from its site in the Ghent port area.',
    },
  },
  c8: {
    id: 'c8',
    name: 'Coastline Hospitality',
    verified: false,
    locationKey: 'bruges',
    description: {
      pl: 'Coastline Hospitality prowadzi hotele i restauracje na wybrzeżu Belgii oraz w zabytkowym centrum Brugii.',
      nl: 'Coastline Hospitality baat hotels en restaurants uit aan de Belgische kust en in het historische centrum van Brugge.',
      fr: 'Coastline Hospitality exploite des hôtels et restaurants sur la côte belge et dans le centre historique de Bruges.',
      en: 'Coastline Hospitality operates hotels and restaurants along the Belgian coast and in the historic centre of Bruges.',
    },
  },
  c9: {
    id: 'c9',
    name: 'ZorgPlus vzw',
    verified: true,
    locationKey: 'leuven',
    description: {
      pl: 'ZorgPlus vzw to organizacja non-profit prowadząca domy opieki dla osób starszych w Brabancji Flamandzkiej.',
      nl: 'ZorgPlus vzw is een non-profit zorgorganisatie met woonzorgcentra voor ouderen in Vlaams-Brabant.',
      fr: 'ZorgPlus vzw est une organisation de soins à but non lucratif qui gère des maisons de repos en Brabant flamand.',
      en: 'ZorgPlus vzw is a non-profit care organisation running residential homes for the elderly in Flemish Brabant.',
    },
  },
  c10: {
    id: 'c10',
    name: 'SeasonWork Belgium',
    verified: false,
    locationKey: 'hasselt',
    description: {
      pl: 'SeasonWork Belgium łączy pracowników sezonowych z gospodarstwami sadowniczymi i firmami ogrodniczymi w Limburgii.',
      nl: 'SeasonWork Belgium brengt seizoenarbeiders in contact met fruitbedrijven en tuinbouwbedrijven in Limburg.',
      fr: 'SeasonWork Belgium met en relation des travailleurs saisonniers avec des exploitations fruitières et horticoles du Limbourg.',
      en: 'SeasonWork Belgium connects seasonal workers with fruit farms and horticultural businesses across Limburg.',
    },
  },
  c11: {
    id: 'c11',
    name: 'Kortrijk Techniek BV',
    verified: true,
    locationKey: 'kortrijk',
    description: {
      pl: 'Kortrijk Techniek BV to firma instalacyjna działająca w branży elektrycznej, hydraulicznej i wykończeniowej.',
      nl: 'Kortrijk Techniek BV is een technisch installatiebedrijf actief in elektriciteit, sanitair en afwerking.',
      fr: 'Kortrijk Techniek BV est une entreprise d\'installations techniques active en électricité, plomberie et finitions.',
      en: 'Kortrijk Techniek BV is a technical installation company active in electricity, plumbing and finishing works.',
    },
  },
} satisfies Record<string, DemoCompany>;

type CompanyId = keyof typeof COMPANY_MAP;

/** Lista firm demonstracyjnych. */
export const demoCompanies: DemoCompany[] = Object.values(COMPANY_MAP);

/* ---------------------------------------------------------------------------
 * Oferty (demonstracyjne) — definicje surowe, składane per język
 * ------------------------------------------------------------------------- */

interface DemoJobRaw {
  id: string;
  occKey: OccKey;
  companyId: CompanyId;
  locationKey: LocationKey;
  category: CategoryKey;
  contractType: ContractType;
  salaryMin?: number;
  salaryMax?: number;
  /** Okres stawki; brak = miesiąc (domyślna wartość `jobs.salary_period`). */
  salaryPeriod?: SalaryPeriod;
  postedDaysAgo: number;
  accommodation: boolean;
  immediate: boolean;
  noLanguageRequired: boolean;
  transport: boolean;
  startDate?: string;
  languageKeys: LangKey[];
  responsibilityKeys: RespKey[];
  mandatoryKeys: MandKey[];
  optionalKeys: OptKey[];
  conditionKeys: CondKey[];
  highlightKeys: HlKey[];
  workingHoursKey: WhKey;
  shiftsKey?: ShKey;
  contextKeys: CtxKey[];
  /** Języki, w których oferta ma treść; brak = wszystkie (#301). */
  contentLocales?: readonly Locale[];
}

const RAW_JOBS: DemoJobRaw[] = [
  {
    id: '1001', occKey: 'warehouseWorker', companyId: 'c1', locationKey: 'antwerp', category: 'warehouse', contractType: 'interim',
    salaryMin: 2400, salaryMax: 2800, postedDaysAgo: 1, accommodation: true, immediate: true, noLanguageRequired: true, transport: true,
    languageKeys: [], responsibilityKeys: ['loadUnload', 'orderPick', 'stock'], mandatoryKeys: ['physical', 'reliable', 'workPermit'],
    optionalKeys: ['forklift', 'experienceBonus'], conditionKeys: ['weekly', 'accommodation', 'ppe'], highlightKeys: ['immediate', 'accommodation', 'noLang'],
    workingHoursKey: 'fulltime', shiftsKey: 'earlyLate', contextKeys: ['immediate', 'accommodation', 'noLang'],
  },
  {
    id: '1002', occKey: 'bricklayer', companyId: 'c2', locationKey: 'brussels', category: 'construction', contractType: 'permanent',
    salaryMin: 2600, salaryMax: 3200, postedDaysAgo: 3, accommodation: false, immediate: true, noLanguageRequired: false, transport: false,
    languageKeys: ['fr'], responsibilityKeys: ['masonry', 'readPlans', 'site'], mandatoryKeys: ['experience', 'physical', 'vcaSafety'],
    optionalKeys: ['frenchBonus', 'ownCar'], conditionKeys: ['longTerm', 'travel', 'ppe'], highlightKeys: ['permanent', 'immediate', 'travel'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['stable', 'team'],
  },
  {
    id: '1003', occKey: 'truckDriver', companyId: 'c3', locationKey: 'ghent', category: 'transport', contractType: 'permanent',
    salaryMin: 2800, salaryMax: 3400, postedDaysAgo: 5, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['drive', 'vehicleCheck', 'loadUnload'], mandatoryKeys: ['licenseCE', 'reliable', 'workPermit'],
    optionalKeys: ['experienceBonus', 'langBonus'], conditionKeys: ['holiday', 'bonus', 'travel'], highlightKeys: ['permanent', 'bonus', 'travel'],
    workingHoursKey: 'fulltime40', shiftsKey: 'earlyLate', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1004', occKey: 'cleaner', companyId: 'c4', locationKey: 'brussels', category: 'cleaning', contractType: 'temporary',
    salaryMin: 2100, salaryMax: 2400, postedDaysAgo: 2, accommodation: false, immediate: true, noLanguageRequired: true, transport: false,
    languageKeys: [], responsibilityKeys: ['clean', 'supplies'], mandatoryKeys: ['reliable', 'physical', 'workPermit'],
    optionalKeys: ['experienceBonus', 'flexible'], conditionKeys: ['weekly', 'travel', 'stableHours'], highlightKeys: ['immediate', 'noLang', 'weeklyPay'],
    workingHoursKey: 'parttime', contextKeys: ['immediate', 'noLang'],
  },
  {
    id: '1005', occKey: 'productionOperator', companyId: 'c5', locationKey: 'hasselt', category: 'production', contractType: 'interim',
    salaryMin: 2300, salaryMax: 2700, postedDaysAgo: 4, accommodation: true, immediate: false, noLanguageRequired: true, transport: true,
    languageKeys: [], responsibilityKeys: ['machine', 'quality', 'assemble'], mandatoryKeys: ['physical', 'availableShifts', 'workPermit'],
    optionalKeys: ['experienceBonus', 'langBonus'], conditionKeys: ['accommodation', 'bonus', 'ppe'], highlightKeys: ['accommodation', 'noLang', 'bonus'],
    workingHoursKey: 'fulltime', shiftsKey: 'three', contextKeys: ['accommodation', 'noLang', 'team'],
  },
  {
    id: '1006', occKey: 'welder', companyId: 'c6', locationKey: 'antwerp', category: 'technical', contractType: 'permanent',
    salaryMin: 2900, salaryMax: 3600, postedDaysAgo: 7, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['weld', 'readPlans', 'quality'], mandatoryKeys: ['weldCert', 'experience', 'vcaSafety'],
    optionalKeys: ['langBonus', 'vca'], conditionKeys: ['holiday', 'bonus', 'ppe'], highlightKeys: ['permanent', 'bonus', 'training'],
    workingHoursKey: 'fulltime', shiftsKey: 'two', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1007', occKey: 'forkliftOperator', companyId: 'c7', locationKey: 'ghent', category: 'logistics', contractType: 'interim',
    salaryMin: 2400, salaryMax: 2900, postedDaysAgo: 2, accommodation: false, immediate: true, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['forklift', 'loadUnload', 'stock'], mandatoryKeys: ['forkliftCert', 'physical', 'reliable'],
    optionalKeys: ['experienceBonus', 'ownCar'], conditionKeys: ['weekly', 'travel', 'ppe'], highlightKeys: ['immediate', 'weeklyPay', 'travel'],
    workingHoursKey: 'fulltime', shiftsKey: 'earlyLate', contextKeys: ['immediate', 'team'],
  },
  {
    id: '1008', occKey: 'kitchenAssistant', companyId: 'c8', locationKey: 'bruges', category: 'hospitality', contractType: 'seasonal',
    salaryMin: 2000, salaryMax: 2300, postedDaysAgo: 6, accommodation: true, immediate: false, noLanguageRequired: true, transport: false,
    startDate: '2026-08-01', languageKeys: [], responsibilityKeys: ['prepFood', 'dishes', 'clean'], mandatoryKeys: ['physical', 'hygiene', 'workPermit'],
    optionalKeys: ['hospitalityExp', 'flexible'], conditionKeys: ['accommodation', 'mealVouchers', 'youngTeam'], highlightKeys: ['seasonal', 'accommodation', 'noLang'],
    workingHoursKey: 'seasonal', shiftsKey: 'weekend', contextKeys: ['seasonal', 'accommodation', 'noLang'],
  },
  {
    id: '1009', occKey: 'careAssistant', companyId: 'c9', locationKey: 'leuven', category: 'care', contractType: 'permanent',
    salaryMin: 2500, salaryMax: 2900, postedDaysAgo: 9, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['careDaily', 'careHygiene', 'careCompany'], mandatoryKeys: ['dutch', 'empathy', 'diploma'],
    optionalKeys: ['experienceBonus', 'longTerm'], conditionKeys: ['holiday', 'training', 'growth'], highlightKeys: ['permanent', 'training', 'travel'],
    workingHoursKey: 'fulltime', shiftsKey: 'earlyLate', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1010', occKey: 'electrician', companyId: 'c11', locationKey: 'mechelen', category: 'technical', contractType: 'permanent',
    salaryMin: 3000, salaryMax: 3800, postedDaysAgo: 11, accommodation: false, immediate: false, noLanguageRequired: false, transport: true,
    languageKeys: ['nl'], responsibilityKeys: ['electric', 'readPlans', 'quality'], mandatoryKeys: ['diploma', 'licenseB', 'vcaSafety'],
    optionalKeys: ['langBonus', 'vca'], conditionKeys: ['holiday', 'bonus', 'growth'], highlightKeys: ['permanent', 'bonus', 'training'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1011', occKey: 'fruitPicker', companyId: 'c10', locationKey: 'hasselt', category: 'seasonal', contractType: 'seasonal',
    salaryMin: 2000, salaryMax: 2200, postedDaysAgo: 0, accommodation: true, immediate: true, noLanguageRequired: true, transport: true,
    startDate: '2026-07-01', languageKeys: [], responsibilityKeys: ['harvest', 'loadUnload', 'quality'], mandatoryKeys: ['physical', 'reliable', 'workPermit'],
    optionalKeys: ['experienceBonus', 'flexible'], conditionKeys: ['accommodation', 'weekly', 'ppe'], highlightKeys: ['seasonal', 'accommodation', 'immediate'],
    workingHoursKey: 'seasonal', shiftsKey: 'weekend', contextKeys: ['seasonal', 'accommodation', 'immediate'],
  },
  {
    id: '1012', occKey: 'painter', companyId: 'c11', locationKey: 'kortrijk', category: 'construction', contractType: 'freelance',
    salaryMin: 3200, salaryMax: 4200, postedDaysAgo: 14, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['paint', 'site', 'quality'], mandatoryKeys: ['experience', 'precise', 'ownTransport'],
    optionalKeys: ['vca', 'langBonus'], conditionKeys: ['bonus', 'ppe', 'growth'], highlightKeys: ['flexible', 'bonus'],
    workingHoursKey: 'flexible', contextKeys: ['growth', 'team'],
  },
  {
    id: '1013', occKey: 'carpenter', companyId: 'c2', locationKey: 'liege', category: 'construction', contractType: 'permanent',
    salaryMin: 2700, salaryMax: 3300, postedDaysAgo: 8, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['fr'], responsibilityKeys: ['carpentry', 'readPlans', 'site'], mandatoryKeys: ['experience', 'precise', 'vcaSafety'],
    optionalKeys: ['frenchBonus', 'ownCar'], conditionKeys: ['longTerm', 'travel', 'ppe'], highlightKeys: ['permanent', 'travel', 'training'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['stable', 'team'],
  },
  {
    id: '1014', occKey: 'orderPicker', companyId: 'c7', locationKey: 'leuven', category: 'warehouse', contractType: 'interim',
    salaryMin: 2300, salaryMax: 2700, postedDaysAgo: 1, accommodation: false, immediate: true, noLanguageRequired: true, transport: true,
    languageKeys: [], responsibilityKeys: ['orderPick', 'loadUnload', 'stock'], mandatoryKeys: ['physical', 'reliable', 'workPermit'],
    optionalKeys: ['forklift', 'flexible'], conditionKeys: ['weekly', 'mealVouchers', 'ppe'], highlightKeys: ['immediate', 'noLang', 'weeklyPay'],
    workingHoursKey: 'fulltime', shiftsKey: 'earlyLate', contextKeys: ['immediate', 'noLang', 'team'],
  },
  {
    id: '1015', occKey: 'cncOperator', companyId: 'c5', locationKey: 'kortrijk', category: 'production', contractType: 'permanent',
    salaryMin: 2800, salaryMax: 3400, postedDaysAgo: 12, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['cnc', 'quality', 'machine'], mandatoryKeys: ['diploma', 'precise', 'availableShifts'],
    optionalKeys: ['experienceBonus', 'langBonus'], conditionKeys: ['holiday', 'bonus', 'training'], highlightKeys: ['permanent', 'bonus', 'training'],
    workingHoursKey: 'fulltime', shiftsKey: 'three', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1016', occKey: 'deliveryDriver', companyId: 'c3', locationKey: 'brussels', category: 'transport', contractType: 'temporary',
    salaryMin: 2300, salaryMax: 2700, postedDaysAgo: 3, accommodation: false, immediate: true, noLanguageRequired: false, transport: false,
    languageKeys: ['fr'], responsibilityKeys: ['drive', 'loadUnload', 'vehicleCheck'], mandatoryKeys: ['licenseB', 'reliable', 'workPermit'],
    optionalKeys: ['frenchBonus', 'ownCar'], conditionKeys: ['weekly', 'travel', 'mealVouchers'], highlightKeys: ['immediate', 'weeklyPay', 'travel'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['immediate', 'team'],
  },
  {
    id: '1017', occKey: 'hotelHousekeeper', companyId: 'c4', locationKey: 'brussels', category: 'hospitality', contractType: 'permanent',
    salaryMin: 2100, salaryMax: 2500, postedDaysAgo: 5, accommodation: false, immediate: false, noLanguageRequired: true, transport: false,
    languageKeys: [], responsibilityKeys: ['serveGuests', 'clean', 'supplies'], mandatoryKeys: ['reliable', 'hygiene', 'workPermit'],
    optionalKeys: ['hospitalityExp', 'langBonus'], conditionKeys: ['mealVouchers', 'stableHours', 'youngTeam'], highlightKeys: ['permanent', 'noLang', 'mealVouchers'],
    workingHoursKey: 'fulltime', shiftsKey: 'earlyLate', contextKeys: ['stable', 'noLang'],
  },
  {
    id: '1018', occKey: 'plumber', companyId: 'c11', locationKey: 'charleroi', category: 'technical', contractType: 'permanent',
    salaryMin: 2900, salaryMax: 3600, postedDaysAgo: 10, accommodation: false, immediate: false, noLanguageRequired: false, transport: true,
    languageKeys: ['fr'], responsibilityKeys: ['plumbingInstall', 'readPlans', 'quality'], mandatoryKeys: ['diploma', 'licenseB', 'experience'],
    optionalKeys: ['frenchBonus', 'vca'], conditionKeys: ['holiday', 'bonus', 'growth'], highlightKeys: ['permanent', 'bonus', 'training'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1019', occKey: 'logisticsCoordinator', companyId: 'c1', locationKey: 'antwerp', category: 'logistics', contractType: 'permanent',
    salaryMin: 3200, salaryMax: 4000, postedDaysAgo: 6, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['en', 'nl'], responsibilityKeys: ['planLogistics', 'stock', 'lead'], mandatoryKeys: ['english', 'experience', 'dutch'],
    optionalKeys: ['computer', 'leadership'], conditionKeys: ['holiday', 'bonus', 'growth'], highlightKeys: ['permanent', 'bonus', 'teamLead'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1020', occKey: 'dishwasher', companyId: 'c8', locationKey: 'ghent', category: 'hospitality', contractType: 'temporary',
    salaryMin: 1900, salaryMax: 2200, postedDaysAgo: 2, accommodation: false, immediate: true, noLanguageRequired: true, transport: false,
    languageKeys: [], responsibilityKeys: ['dishes', 'clean', 'prepFood'], mandatoryKeys: ['physical', 'hygiene', 'workPermit'],
    optionalKeys: ['flexible', 'hospitalityExp'], conditionKeys: ['weekly', 'mealVouchers', 'youngTeam'], highlightKeys: ['immediate', 'noLang', 'weeklyPay'],
    workingHoursKey: 'parttime', shiftsKey: 'weekend', contextKeys: ['immediate', 'noLang', 'team'],
  },
  {
    id: '1021', occKey: 'elderlyCareAide', companyId: 'c9', locationKey: 'bruges', category: 'care', contractType: 'permanent',
    salaryMin: 2600, salaryMax: 3000, postedDaysAgo: 13, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['careDaily', 'careHygiene', 'careCompany'], mandatoryKeys: ['dutch', 'empathy', 'diploma'],
    optionalKeys: ['experienceBonus', 'longTerm'], conditionKeys: ['holiday', 'training', 'growth'], highlightKeys: ['permanent', 'training', 'travel'],
    workingHoursKey: 'fulltime', shiftsKey: 'earlyLate', contextKeys: ['stable', 'team'],
  },
  {
    id: '1022', occKey: 'scaffolder', companyId: 'c6', locationKey: 'antwerp', category: 'construction', contractType: 'interim',
    salaryMin: 2700, salaryMax: 3300, postedDaysAgo: 4, accommodation: true, immediate: false, noLanguageRequired: false, transport: true,
    languageKeys: ['nl'], responsibilityKeys: ['scaffold', 'site', 'loadUnload'], mandatoryKeys: ['physical', 'vcaSafety', 'workPermit'],
    optionalKeys: ['experienceBonus', 'langBonus'], conditionKeys: ['accommodation', 'weekly', 'ppe'], highlightKeys: ['accommodation', 'weeklyPay', 'travel'],
    workingHoursKey: 'fulltime', shiftsKey: 'day', contextKeys: ['accommodation', 'team'],
  },
  {
    id: '1023', occKey: 'machineOperator', companyId: 'c5', locationKey: 'mechelen', category: 'production', contractType: 'interim',
    salaryMin: 2400, salaryMax: 2900, postedDaysAgo: 1, accommodation: false, immediate: false, noLanguageRequired: true, transport: true,
    languageKeys: [], responsibilityKeys: ['machine', 'quality', 'assemble'], mandatoryKeys: ['physical', 'availableShifts', 'workPermit'],
    optionalKeys: ['experienceBonus', 'forklift'], conditionKeys: ['weekly', 'bonus', 'ppe'], highlightKeys: ['noLang', 'weeklyPay', 'bonus'],
    workingHoursKey: 'fulltime', shiftsKey: 'three', contextKeys: ['noLang', 'team'],
  },
  {
    id: '1024', occKey: 'warehouseSupervisor', companyId: 'c7', locationKey: 'liege', category: 'warehouse', contractType: 'permanent',
    // Bez kwoty (#22): paszport pomija pole wynagrodzenia.
    postedDaysAgo: 7, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['fr'], responsibilityKeys: ['lead', 'stock', 'planLogistics'], mandatoryKeys: ['experience', 'french', 'reliable'],
    optionalKeys: ['leadership', 'computer'], conditionKeys: ['holiday', 'bonus', 'growth'], highlightKeys: ['permanent', 'teamLead', 'bonus'],
    workingHoursKey: 'fulltime', shiftsKey: 'two', contextKeys: ['stable', 'growth'],
  },
  {
    id: '1025', occKey: 'gardener', companyId: 'c10', locationKey: 'leuven', category: 'seasonal', contractType: 'seasonal',
    // Stawka godzinowa z groszami (#22).
    salaryMin: 14.5, salaryMax: 16.75, salaryPeriod: 'hour', postedDaysAgo: 3, accommodation: false, immediate: true, noLanguageRequired: false, transport: true,
    startDate: '2026-08-01', languageKeys: ['nl'], responsibilityKeys: ['garden', 'harvest', 'site'], mandatoryKeys: ['physical', 'reliable', 'ownTransport'],
    optionalKeys: ['experienceBonus', 'flexible'], conditionKeys: ['weekly', 'travel', 'ppe'], highlightKeys: ['seasonal', 'immediate', 'travel'],
    workingHoursKey: 'seasonal', shiftsKey: 'day', contextKeys: ['seasonal', 'immediate', 'team'],
  },
  {
    id: '1026', occKey: 'logisticsIntern', companyId: 'c7', locationKey: 'ghent', category: 'logistics', contractType: 'internship',
    // Tylko dolna granica (#22).
    salaryMin: 850, postedDaysAgo: 5, accommodation: false, immediate: false, noLanguageRequired: false, transport: false,
    languageKeys: ['nl'], responsibilityKeys: ['stock', 'orderPick', 'planLogistics'], mandatoryKeys: ['student', 'reliable', 'dutch'],
    optionalKeys: ['computer', 'langBonus'], conditionKeys: ['training', 'mealVouchers', 'youngTeam'], highlightKeys: ['student', 'training'],
    workingHoursKey: 'parttime', shiftsKey: 'day', contextKeys: ['growth', 'team'],
    // Pracodawca z Flandrii opublikował treść tylko po niderlandzku (scenariusz #301).
    contentLocales: ['nl'],
  },
];

/* ---------------------------------------------------------------------------
 * Składanie ofert (raw -> JobDetail) w wybranym języku
 * ------------------------------------------------------------------------- */

function buildSlug(raw: DemoJobRaw): string {
  return `${OCC_SLUG[raw.occKey]}-${raw.locationKey}-${raw.id}`;
}

function composeDescription(raw: DemoJobRaw, locale: Locale, companyName: string): string {
  const role = OCCUPATION[raw.occKey][locale];
  const city = CITY[raw.locationKey][locale];
  const lead = LEAD[locale]
    .replace('{company}', companyName)
    .replace('{role}', role)
    .replace('{city}', city);
  const extra = raw.contextKeys.map((k) => CTX[k][locale]).join(' ');
  return extra ? `${lead} ${extra}` : lead;
}

function resolveJobDetail(raw: DemoJobRaw, locale: Locale): JobDetail {
  const company = COMPANY_MAP[raw.companyId];
  const regionKey = REGION_OF[raw.locationKey];
  const city = CITY[raw.locationKey][locale];
  const region = REGION[regionKey][locale];
  // Oferta może mieć treść tylko w części języków (#301) — jak `get_public_job`, pokazujemy
  // wtedy tłumaczenie w pierwszym dostępnym języku, a dane oferty (miasto, region) w języku strony.
  const available = raw.contentLocales ?? routing.locales;
  const content: Locale = available.includes(locale) ? locale : available[0]!;
  const publishedAt = new Date(NOW_MS - raw.postedDaysAgo * DAY_MS).toISOString();

  const base: JobListItem = {
    id: raw.id,
    slug: buildSlug(raw),
    title: `${OCCUPATION[raw.occKey][content]} – ${CITY[raw.locationKey][content]}`,
    companyName: company.name,
    companyVerified: company.verified,
    city,
    region,
    contractType: raw.contractType,
    salaryMin: raw.salaryMin,
    salaryMax: raw.salaryMax,
    currency: CURRENCY,
    salaryPeriod: raw.salaryPeriod ?? 'month',
    publishedAt,
    isNew: raw.postedDaysAgo <= NEW_DAYS,
    highlights: raw.highlightKeys.map((k) => HL[k][content]),
    category: raw.category,
    accommodation: raw.accommodation,
    immediate: raw.immediate,
    noLanguageRequired: raw.noLanguageRequired,
  };

  return {
    ...base,
    description: composeDescription(raw, content, company.name),
    responsibilities: raw.responsibilityKeys.map((k) => RESP[k][content]),
    requirementsMandatory: raw.mandatoryKeys.map((k) => MAND[k][content]),
    requirementsOptional: raw.optionalKeys.map((k) => OPT[k][content]),
    conditions: raw.conditionKeys.map((k) => COND[k][content]),
    workingHours: WH[raw.workingHoursKey][content],
    shifts: raw.shiftsKey ? SH[raw.shiftsKey][content] : undefined,
    languages: raw.languageKeys.map((k) => LANG[k][locale]),
    transport: raw.transport,
    startDate: raw.startDate,
    companyDescription: company.description[content],
    contentLocale: content,
    availableLocales: [...available],
  };
}

/* ---------------------------------------------------------------------------
 * Publiczne API danych demonstracyjnych
 * ------------------------------------------------------------------------- */

/** Wszystkie oferty demonstracyjne złożone w wybranym języku (kolejność źródłowa). */
export function resolveDemoJobs(locale: Locale): JobDetail[] {
  return RAW_JOBS.map((raw) => resolveJobDetail(raw, locale));
}

/** Pojedyncza oferta demonstracyjna po slugu w wybranym języku (lub null). */
export function resolveDemoJobBySlug(slug: string, locale: Locale): JobDetail | null {
  const raw = RAW_JOBS.find((job) => buildSlug(job) === slug);
  return raw ? resolveJobDetail(raw, locale) : null;
}

/** Języki z treścią dla oferty demonstracyjnej (sitemap, #301). */
export function demoJobContentLocales(id: string): Locale[] {
  const raw = RAW_JOBS.find((job) => job.id === id);
  return [...(raw?.contentLocales ?? routing.locales)];
}

const CATEGORY_KEYS: CategoryKey[] = [
  'construction', 'transport', 'warehouse', 'production', 'technical',
  'cleaning', 'hospitality', 'care', 'logistics', 'seasonal',
];

const LOCATION_KEYS: LocationKey[] = [
  'brussels', 'antwerp', 'ghent', 'leuven', 'mechelen',
  'hasselt', 'liege', 'charleroi', 'bruges', 'kortrijk',
];

/** Kategorie z liczbą ofert demonstracyjnych (dla kafelków na stronie głównej). */
export const demoCategories: { key: CategoryKey; jobCount: number }[] = CATEGORY_KEYS.map(
  (key) => ({ key, jobCount: RAW_JOBS.filter((job) => job.category === key).length }),
);

/** Lokalizacje z liczbą ofert demonstracyjnych. */
export const demoLocations: { key: LocationKey; jobCount: number }[] = LOCATION_KEYS.map(
  (key) => ({ key, jobCount: RAW_JOBS.filter((job) => job.locationKey === key).length }),
);

/** Gotowa lista ofert demonstracyjnych (JobDetail) w domyślnym języku aplikacji. */
export const demoJobs: JobDetail[] = resolveDemoJobs(routing.defaultLocale);
