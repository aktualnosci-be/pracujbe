/**
 * Nawigator „Jak zacząć pracę w Belgii?” (#907) — treść STATYCZNA, wersjonowana w repozytorium
 * (jak poradniki w `./guides.ts`, bez CMS/DB), więc strony `/poradniki/jak-zaczac-prace`
 * i `/poradniki/jak-zaczac-prace/<region>` renderują się bez zmiennych środowiskowych (SSG).
 *
 * Drzewo wyboru ma dwa poziomy: region pracy → potrzeba. Każda potrzeba ma kroki wspólne dla
 * całej Belgii oraz wskazane fakty regionu (język, uznawanie dyplomów, publiczne usługi). Chrome
 * UI (nagłówki, zastrzeżenie zakresu, data przeglądu) pochodzi z i18n (`guides.navigator*`).
 *
 * Zakres (granice z #907): treść ogólna i informacyjna. Nie oceniamy statusu pobytowego,
 * uprawnień do pracy ani równoważności dyplomu — kierujemy do właściwej instytucji. Bez nazw
 * konkretnych urzędów i aktów prawnych oraz bez linków zewnętrznych: lista oficjalnych adresów
 * to decyzja właściciela treści (patrz `NAVIGATOR_REVIEW`).
 */

import { routing, type Locale } from '@/i18n/routing';

/** Ścieżka nawigatora (segment bez prefiksu języka) — wspólna dla stron i sitemap. */
export const NAVIGATOR_PATH = '/poradniki/jak-zaczac-prace';

/** Region pracy — stabilny klucz i slug adresu (wspólny dla wszystkich języków). */
export const NAVIGATOR_REGIONS = ['bruksela', 'flandria', 'walonia'] as const;
export type NavigatorRegion = (typeof NAVIGATOR_REGIONS)[number];

/** Potrzeba kandydata — stabilny klucz (także kotwica sekcji na stronie regionu). */
export const NAVIGATOR_NEEDS = [
  'degree-job',
  'diploma-recognition',
  'experience-validation',
  'language-course',
] as const;
export type NavigatorNeed = (typeof NAVIGATOR_NEEDS)[number];

/** Fakt regionu dołączany do potrzeby. */
export type RegionFact = 'language' | 'recognition' | 'services';

/**
 * Właściciel treści i terminy przeglądu (#907: „z właścicielem treści i terminem przeglądu”).
 * `reviewedAt` widać na stronie; przegląd najpóźniej w `reviewDueAt` (test pilnuje odstępu
 * ≤ 12 miesięcy i poprawnej kolejności dat).
 */
export const NAVIGATOR_REVIEW = {
  owner: 'Pracuj.be — redakcja poradników',
  reviewedAt: '2026-10-01',
  reviewDueAt: '2027-04-01',
} as const;

interface RegionTranslation {
  readonly name: string;
  readonly summary: string;
  readonly facts: Record<RegionFact, string>;
}

interface NeedTranslation {
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
}

interface NeedDefinition {
  /** Fakty regionu pokazywane pod krokami tej potrzeby (kolejność = kolejność na stronie). */
  readonly regionFacts: readonly RegionFact[];
  readonly translations: Record<Locale, NeedTranslation>;
}

const REGIONS: Record<NavigatorRegion, Record<Locale, RegionTranslation>> = {
  bruksela: {
    pl: {
      name: 'Bruksela',
      summary: 'Region dwujęzyczny: francuski i niderlandzki, w wielu firmach także angielski.',
      facts: {
        language:
          'Bruksela jest dwujęzyczna — sprawy urzędowe załatwisz po francusku albo po niderlandzku. W wielu firmach przydaje się też angielski.',
        recognition:
          'W Brukseli o uznanie dyplomu występujesz do wspólnoty francuskojęzycznej albo niderlandzkojęzycznej — zwykle tej, w której języku chcesz pracować lub dalej się uczyć.',
        services:
          'W Brukseli działa regionalny publiczny urząd pracy. Kursy francuskiego i niderlandzkiego prowadzą ośrodki obu wspólnot językowych.',
      },
    },
    nl: {
      name: 'Brussel',
      summary: 'Tweetalig gewest: Frans en Nederlands, in veel bedrijven ook Engels.',
      facts: {
        language:
          'Brussel is tweetalig — officiële zaken regel je in het Frans of in het Nederlands. In veel bedrijven is ook Engels handig.',
        recognition:
          'In Brussel vraag je de erkenning van je diploma aan bij de Franstalige of de Nederlandstalige gemeenschap — meestal die in wiens taal je wilt werken of verder studeren.',
        services:
          'In Brussel is er een gewestelijke openbare arbeidsbemiddelingsdienst. Cursussen Frans en Nederlands worden gegeven door centra van beide taalgemeenschappen.',
      },
    },
    fr: {
      name: 'Bruxelles',
      summary: 'Région bilingue : français et néerlandais, et souvent l’anglais en entreprise.',
      facts: {
        language:
          'Bruxelles est bilingue : les démarches officielles se font en français ou en néerlandais. Dans de nombreuses entreprises, l’anglais est aussi utile.',
        recognition:
          'À Bruxelles, la reconnaissance du diplôme se demande auprès de la Communauté française ou de la Communauté flamande — en général celle dont vous voulez utiliser la langue pour travailler ou poursuivre vos études.',
        services:
          'Bruxelles dispose d’un service public régional de l’emploi. Des cours de français et de néerlandais sont proposés par des centres des deux communautés linguistiques.',
      },
    },
    en: {
      name: 'Brussels',
      summary: 'A bilingual region: French and Dutch, with English common in many companies.',
      facts: {
        language:
          'Brussels is bilingual — official matters are handled in French or in Dutch. English is also useful in many companies.',
        recognition:
          'In Brussels, you apply for recognition of your diploma to either the French-speaking or the Dutch-speaking community — usually the one whose language you want to work or study in.',
        services:
          'Brussels has a regional public employment service. French and Dutch courses are run by centres of both language communities.',
      },
    },
  },
  flandria: {
    pl: {
      name: 'Flandria',
      summary: 'Północ Belgii, językiem urzędowym jest niderlandzki.',
      facts: {
        language:
          'Językiem urzędowym Flandrii jest niderlandzki — w nim prowadzone są sprawy urzędowe i większość ogłoszeń.',
        recognition:
          'We Flandrii uznaniem zagranicznych dyplomów zajmuje się wspólnota niderlandzkojęzyczna.',
        services:
          'We Flandrii działa regionalny publiczny urząd pracy. Po rejestracji pomaga w szukaniu pracy i kieruje na kursy niderlandzkiego oraz szkolenia zawodowe.',
      },
    },
    nl: {
      name: 'Vlaanderen',
      summary: 'Het noorden van België, de officiële taal is het Nederlands.',
      facts: {
        language:
          'De officiële taal van Vlaanderen is het Nederlands — daarin verlopen officiële zaken en de meeste vacatures.',
        recognition:
          'In Vlaanderen is de Nederlandstalige gemeenschap bevoegd voor de erkenning van buitenlandse diploma’s.',
        services:
          'In Vlaanderen is er een gewestelijke openbare arbeidsbemiddelingsdienst. Na je inschrijving helpt die bij het zoeken naar werk en verwijst je naar cursussen Nederlands en beroepsopleidingen.',
      },
    },
    fr: {
      name: 'Flandre',
      summary: 'Le nord de la Belgique, la langue officielle est le néerlandais.',
      facts: {
        language:
          'La langue officielle de la Flandre est le néerlandais : les démarches officielles et la plupart des offres d’emploi sont en néerlandais.',
        recognition:
          'En Flandre, la reconnaissance des diplômes étrangers relève de la Communauté flamande.',
        services:
          'La Flandre dispose d’un service public régional de l’emploi. Après inscription, il aide à chercher un emploi et oriente vers des cours de néerlandais et des formations professionnelles.',
      },
    },
    en: {
      name: 'Flanders',
      summary: 'Northern Belgium, where the official language is Dutch.',
      facts: {
        language:
          'The official language of Flanders is Dutch — official matters and most job ads are in Dutch.',
        recognition:
          'In Flanders, the Dutch-speaking community is responsible for recognising foreign diplomas.',
        services:
          'Flanders has a regional public employment service. Once you register, it helps you look for work and refers you to Dutch courses and vocational training.',
      },
    },
  },
  walonia: {
    pl: {
      name: 'Walonia',
      summary: 'Południe Belgii, językiem urzędowym jest francuski, na wschodzie także niemiecki.',
      facts: {
        language:
          'Językiem urzędowym Walonii jest francuski. W gminach we wschodniej części regionu językiem urzędowym jest niemiecki.',
        recognition:
          'W Walonii uznaniem dyplomów zajmuje się wspólnota francuskojęzyczna, a w gminach niemieckojęzycznych — wspólnota niemieckojęzyczna.',
        services:
          'W Walonii działa regionalny publiczny urząd pracy. Po rejestracji pomaga w szukaniu pracy i kieruje na kursy francuskiego oraz szkolenia zawodowe.',
      },
    },
    nl: {
      name: 'Wallonië',
      summary: 'Het zuiden van België, de officiële taal is het Frans, in het oosten ook het Duits.',
      facts: {
        language:
          'De officiële taal van Wallonië is het Frans. In de gemeenten in het oosten van het gewest is het Duits de officiële taal.',
        recognition:
          'In Wallonië is de Franstalige gemeenschap bevoegd voor de erkenning van diploma’s, in de Duitstalige gemeenten de Duitstalige gemeenschap.',
        services:
          'In Wallonië is er een gewestelijke openbare arbeidsbemiddelingsdienst. Na je inschrijving helpt die bij het zoeken naar werk en verwijst je naar cursussen Frans en beroepsopleidingen.',
      },
    },
    fr: {
      name: 'Wallonie',
      summary: 'Le sud de la Belgique, la langue officielle est le français, et l’allemand à l’est.',
      facts: {
        language:
          'La langue officielle de la Wallonie est le français. Dans les communes de l’est de la région, la langue officielle est l’allemand.',
        recognition:
          'En Wallonie, la reconnaissance des diplômes relève de la Communauté française et, dans les communes germanophones, de la Communauté germanophone.',
        services:
          'La Wallonie dispose d’un service public régional de l’emploi. Après inscription, il aide à chercher un emploi et oriente vers des cours de français et des formations professionnelles.',
      },
    },
    en: {
      name: 'Wallonia',
      summary: 'Southern Belgium, where the official language is French, and German in the east.',
      facts: {
        language:
          'The official language of Wallonia is French. In the municipalities in the east of the region, the official language is German.',
        recognition:
          'In Wallonia, the French-speaking community is responsible for recognising diplomas, and in the German-speaking municipalities the German-speaking community.',
        services:
          'Wallonia has a regional public employment service. Once you register, it helps you look for work and refers you to French courses and vocational training.',
      },
    },
  },
};

const NEEDS: Record<NavigatorNeed, NeedDefinition> = {
  'degree-job': {
    regionFacts: ['services', 'language'],
    translations: {
      pl: {
        title: 'Praca zgodna z wykształceniem',
        summary: 'Chcesz pracować w zawodzie, w którym masz wykształcenie.',
        steps: [
          'Sprawdź, czy Twój zawód jest regulowany (np. zawody medyczne, nauczyciel, niektóre zawody techniczne). Wtedy przed rozpoczęciem pracy potrzebne jest uznanie kwalifikacji.',
          'W zawodzie nieregulowanym możesz szukać pracy bez formalnego uznania — dyplom i doświadczenie ocenia pracodawca. Przydaje się tłumaczenie dyplomu i opis programu studiów.',
          'Zarejestruj się w regionalnym urzędzie pracy jako osoba szukająca pracy — doradca pomoże ustalić, jakie kroki są potrzebne w Twoim przypadku.',
          'Na liście ofert Pracuj.be filtruj po branży i mieście. Sposób aplikowania podaje każde ogłoszenie.',
        ],
      },
      nl: {
        title: 'Werk dat bij je opleiding aansluit',
        summary: 'Je wilt werken in het beroep waarvoor je hebt gestudeerd.',
        steps: [
          'Ga na of je beroep gereglementeerd is (bv. medische beroepen, leerkracht, sommige technische beroepen). Dan heb je een erkenning van je kwalificaties nodig voordat je begint te werken.',
          'Voor een niet-gereglementeerd beroep kun je werk zoeken zonder formele erkenning — de werkgever beoordeelt je diploma en ervaring. Een vertaling van je diploma en een beschrijving van je opleiding helpen.',
          'Schrijf je in als werkzoekende bij de gewestelijke arbeidsbemiddelingsdienst — een consulent helpt je bepalen welke stappen in jouw situatie nodig zijn.',
          'Filter in de vacaturelijst van Pracuj.be op sector en stad. Hoe je solliciteert, staat in elke vacature.',
        ],
      },
      fr: {
        title: 'Un emploi lié à votre formation',
        summary: 'Vous voulez travailler dans le métier pour lequel vous avez étudié.',
        steps: [
          'Vérifiez si votre métier est réglementé (p. ex. professions médicales, enseignant, certains métiers techniques). Dans ce cas, une reconnaissance de vos qualifications est nécessaire avant de commencer à travailler.',
          'Pour un métier non réglementé, vous pouvez chercher un emploi sans reconnaissance formelle : c’est l’employeur qui évalue votre diplôme et votre expérience. Une traduction du diplôme et une description du programme d’études sont utiles.',
          'Inscrivez-vous comme demandeur d’emploi auprès du service public régional de l’emploi : un conseiller vous aide à déterminer les démarches nécessaires dans votre cas.',
          'Sur la liste des offres de Pracuj.be, filtrez par secteur et par ville. Chaque annonce indique comment postuler.',
        ],
      },
      en: {
        title: 'A job in your field of study',
        summary: 'You want to work in the profession you trained for.',
        steps: [
          'Check whether your profession is regulated (e.g. medical professions, teaching, some technical professions). If it is, your qualifications must be recognised before you start working.',
          'For a non-regulated profession you can look for work without formal recognition — the employer assesses your diploma and experience. A translation of your diploma and a description of your study programme help.',
          'Register as a jobseeker with the regional public employment service — an adviser helps you work out which steps you need in your situation.',
          'On the Pracuj.be job list, filter by sector and city. Each job ad says how to apply.',
        ],
      },
    },
  },
  'diploma-recognition': {
    regionFacts: ['recognition', 'language'],
    translations: {
      pl: {
        title: 'Uznanie zagranicznego dyplomu',
        summary: 'Potrzebujesz formalnego potwierdzenia, że Twój dyplom jest równoważny belgijskiemu.',
        steps: [
          'Ustal, czy uznania potrzebujesz do pracy (zawód regulowany), czy do dalszej nauki — to zwykle różne procedury.',
          'Przygotuj dyplom, suplement lub wykaz ocen oraz — jeśli jest wymagane — tłumaczenie przysięgłe.',
          'Złóż wniosek we właściwej wspólnocie językowej (patrz niżej). Procedura może wiązać się z opłatą i trwać kilka miesięcy, więc zacznij wcześnie.',
          'Decyzję o równoważności wydaje wyłącznie właściwa instytucja — Pracuj.be jej nie ocenia.',
        ],
      },
      nl: {
        title: 'Erkenning van een buitenlands diploma',
        summary: 'Je hebt een formele bevestiging nodig dat je diploma gelijkwaardig is aan een Belgisch diploma.',
        steps: [
          'Bepaal of je de erkenning nodig hebt om te werken (gereglementeerd beroep) of om verder te studeren — dat zijn meestal verschillende procedures.',
          'Zorg voor je diploma, een diplomasupplement of puntenlijst en — als dat gevraagd wordt — een beëdigde vertaling.',
          'Dien je aanvraag in bij de bevoegde taalgemeenschap (zie hieronder). De procedure kan betalend zijn en enkele maanden duren, dus begin op tijd.',
          'Alleen de bevoegde instelling beslist over de gelijkwaardigheid — Pracuj.be beoordeelt die niet.',
        ],
      },
      fr: {
        title: 'Équivalence d’un diplôme étranger',
        summary: 'Vous avez besoin d’une confirmation officielle que votre diplôme équivaut à un diplôme belge.',
        steps: [
          'Déterminez si vous avez besoin de l’équivalence pour travailler (métier réglementé) ou pour poursuivre des études : ce sont généralement des procédures différentes.',
          'Rassemblez votre diplôme, le supplément au diplôme ou le relevé de notes et, si c’est exigé, une traduction jurée.',
          'Introduisez votre demande auprès de la communauté linguistique compétente (voir ci-dessous). La procédure peut être payante et durer plusieurs mois : commencez tôt.',
          'Seule l’institution compétente décide de l’équivalence : Pracuj.be ne l’évalue pas.',
        ],
      },
      en: {
        title: 'Recognition of a foreign diploma',
        summary: 'You need formal confirmation that your diploma is equivalent to a Belgian one.',
        steps: [
          'Work out whether you need recognition to work (regulated profession) or to continue studying — these are usually different procedures.',
          'Gather your diploma, the diploma supplement or transcript and — if required — a sworn translation.',
          'Apply to the competent language community (see below). The procedure may involve a fee and take several months, so start early.',
          'Only the competent institution decides on equivalence — Pracuj.be does not assess it.',
        ],
      },
    },
  },
  'experience-validation': {
    regionFacts: ['services'],
    translations: {
      pl: {
        title: 'Potwierdzenie doświadczenia',
        summary: 'Masz doświadczenie zawodowe, ale bez dyplomu w tym zawodzie.',
        steps: [
          'W Belgii umiejętności zdobyte w pracy możesz potwierdzić praktycznym sprawdzianem w uznanym ośrodku i uzyskać oficjalny certyfikat.',
          'Sprawdź, czy dla Twojego zawodu taki sprawdzian istnieje — lista zawodów jest ograniczona.',
          'Przygotuj dowody doświadczenia: świadectwa pracy, referencje i opis wykonywanych zadań.',
          'Uzyskany certyfikat podaj, kontaktując się z pracodawcą z ogłoszenia.',
        ],
      },
      nl: {
        title: 'Je ervaring laten bevestigen',
        summary: 'Je hebt werkervaring, maar geen diploma voor dat beroep.',
        steps: [
          'In België kun je vaardigheden die je op het werk hebt opgedaan laten bevestigen met een praktijkproef in een erkend centrum en een officieel bewijs krijgen.',
          'Ga na of zo’n proef voor jouw beroep bestaat — de lijst met beroepen is beperkt.',
          'Verzamel bewijzen van je ervaring: arbeidsattesten, referenties en een beschrijving van je taken.',
          'Vermeld het behaalde bewijs wanneer je contact opneemt met de werkgever uit de vacature.',
        ],
      },
      fr: {
        title: 'Faire valider votre expérience',
        summary: 'Vous avez de l’expérience professionnelle, mais pas de diplôme dans ce métier.',
        steps: [
          'En Belgique, vous pouvez faire valider les compétences acquises au travail par une épreuve pratique dans un centre agréé et obtenir un titre officiel.',
          'Vérifiez si une telle épreuve existe pour votre métier : la liste des métiers est limitée.',
          'Rassemblez les preuves de votre expérience : attestations de travail, références et description de vos tâches.',
          'Mentionnez le titre obtenu lorsque vous contactez l’employeur de l’annonce.',
        ],
      },
      en: {
        title: 'Validating your experience',
        summary: 'You have work experience, but no diploma in that profession.',
        steps: [
          'In Belgium, you can have skills gained at work validated through a practical test at an approved centre and receive an official certificate.',
          'Check whether such a test exists for your profession — the list of professions is limited.',
          'Gather proof of your experience: employment certificates, references and a description of your tasks.',
          'Mention the certificate when you contact the employer from the job ad.',
        ],
      },
    },
  },
  'language-course': {
    regionFacts: ['language', 'services'],
    translations: {
      pl: {
        title: 'Kurs języka',
        summary: 'Chcesz nauczyć się języka używanego w miejscu pracy.',
        steps: [
          'Ustal, którego języka potrzebujesz w miejscu pracy (patrz niżej).',
          'Osoby zarejestrowane w regionalnym urzędzie pracy mogą korzystać z bezpłatnych lub tanich kursów — szczegóły podaje urząd.',
          'Kursy prowadzą też szkoły dla dorosłych i gminy, często wieczorami.',
          'Zacznij od słownictwa ze swojej branży — to daje najszybszy efekt w pracy.',
          'Na liście ofert Pracuj.be filtr „Bez wymogu językowego” pokazuje oferty, w których pracodawca nie wymaga lokalnego języka.',
        ],
      },
      nl: {
        title: 'Een taalcursus',
        summary: 'Je wilt de taal leren die op de werkplek gesproken wordt.',
        steps: [
          'Bepaal welke taal je op de werkplek nodig hebt (zie hieronder).',
          'Wie ingeschreven is bij de gewestelijke arbeidsbemiddelingsdienst, kan gratis of goedkope cursussen volgen — de dienst geeft je de details.',
          'Ook centra voor volwassenenonderwijs en gemeenten organiseren cursussen, vaak ’s avonds.',
          'Begin met de woordenschat van je sector — dat werkt het snelst op het werk.',
          'In de vacaturelijst van Pracuj.be toont de filter „Geen taalvereiste” vacatures waarvoor de werkgever geen lokale taal vraagt.',
        ],
      },
      fr: {
        title: 'Un cours de langue',
        summary: 'Vous voulez apprendre la langue utilisée sur le lieu de travail.',
        steps: [
          'Déterminez la langue dont vous avez besoin sur votre lieu de travail (voir ci-dessous).',
          'Les personnes inscrites auprès du service public régional de l’emploi peuvent suivre des cours gratuits ou peu coûteux : le service vous donne les détails.',
          'Des écoles pour adultes et des communes organisent aussi des cours, souvent en soirée.',
          'Commencez par le vocabulaire de votre secteur : c’est ce qui aide le plus vite au travail.',
          'Sur la liste des offres de Pracuj.be, le filtre « Sans exigence linguistique » affiche les offres pour lesquelles l’employeur n’exige pas la langue locale.',
        ],
      },
      en: {
        title: 'A language course',
        summary: 'You want to learn the language used at work.',
        steps: [
          'Work out which language you need at your workplace (see below).',
          'People registered with the regional public employment service can take free or low-cost courses — the service gives you the details.',
          'Adult education centres and municipalities also run courses, often in the evening.',
          'Start with the vocabulary of your sector — it helps fastest at work.',
          'On the Pracuj.be job list, the “No language required” filter shows jobs where the employer does not require the local language.',
        ],
      },
    },
  },
};

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

export function isNavigatorRegion(value: string): value is NavigatorRegion {
  return (NAVIGATOR_REGIONS as readonly string[]).includes(value);
}

/** Wpis regionu na stronie wyboru. */
export interface NavigatorRegionEntry {
  readonly slug: NavigatorRegion;
  readonly name: string;
  readonly summary: string;
}

/** Potrzeba rozwiązana dla regionu i języka. */
export interface NavigatorNeedEntry {
  readonly key: NavigatorNeed;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly string[];
  /** Fakty wybranego regionu właściwe dla tej potrzeby. */
  readonly regionFacts: readonly string[];
}

/** Strona regionu: region + wszystkie potrzeby z faktami TEGO regionu. */
export interface NavigatorRegionGuide extends NavigatorRegionEntry {
  readonly needs: readonly NavigatorNeedEntry[];
}

export function getNavigatorRegions(locale: string): NavigatorRegionEntry[] {
  const lang = toLocale(locale);
  return NAVIGATOR_REGIONS.map((slug) => ({
    slug,
    name: REGIONS[slug][lang].name,
    summary: REGIONS[slug][lang].summary,
  }));
}

/** Przewodnik dla regionu w danym języku; `null`, gdy region nieznany. */
export function getNavigatorRegionGuide(region: string, locale: string): NavigatorRegionGuide | null {
  if (!isNavigatorRegion(region)) return null;
  const lang = toLocale(locale);
  const content = REGIONS[region][lang];
  return {
    slug: region,
    name: content.name,
    summary: content.summary,
    needs: NAVIGATOR_NEEDS.map((key) => {
      const need = NEEDS[key];
      const t = need.translations[lang];
      return {
        key,
        title: t.title,
        summary: t.summary,
        steps: t.steps,
        regionFacts: need.regionFacts.map((fact) => content.facts[fact]),
      };
    }),
  };
}
