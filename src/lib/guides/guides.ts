/**
 * Poradniki (blog) — Pracuj.be.
 *
 * Treść artykułów jest STATYCZNA i wersjonowana w repozytorium (bez CMS/DB). Dzięki temu
 * strony `/poradniki` i `/poradniki/<slug>` renderują się BEZ zmiennych środowiskowych
 * (SSG) i są indeksowalne. Chrome UI (nagłówki listy, „Czytaj", „min czytania") pochodzi
 * z i18n (`src/messages/*` namespace `guides`) — TUTAJ trzymamy wyłącznie treść artykułów.
 *
 * Tłumaczenia: treść polska jest pełna; nl/fr/en zawierają co najmniej tytuł + zajawkę
 * (`excerpt`) oraz skróconą treść. Wszystkie 4 języki są obecne dla każdego poradnika,
 * więc helper nie potrzebuje fallbacku (typ `Record<Locale, …>` gwarantuje komplet).
 *
 * UWAGA merytoryczna: poradniki mają charakter ogólny i informacyjny. Nie stanowią porady
 * prawnej ani podatkowej — każdy artykuł odsyła do oficjalnych źródeł.
 */

import { routing, type Locale } from '@/i18n/routing';

/** Kategoria poradnika — stabilny klucz (etykieta w i18n: `guides.cat<Nazwa>`). */
export type GuideCategory =
  | 'jobSearch'
  | 'contracts'
  | 'housing'
  | 'admin'
  | 'driving'
  | 'safety';

/** Blok treści artykułu (strukturalny — renderowany przez `GuideContent`). */
export type GuideBlock =
  | { readonly type: 'heading'; readonly text: string }
  | { readonly type: 'paragraph'; readonly text: string }
  | { readonly type: 'list'; readonly items: readonly string[] };

/** Treść poradnika w jednym języku. */
export interface GuideTranslation {
  readonly title: string;
  readonly excerpt: string;
  readonly body: readonly GuideBlock[];
}

/** Surowy poradnik (wszystkie języki). */
export interface Guide {
  readonly slug: string;
  readonly category: GuideCategory;
  /** Data publikacji (ISO, `YYYY-MM-DD`) — stabilna między buildami. */
  readonly publishedAt: string;
  /** Data ostatniej zmiany treści (ISO, `YYYY-MM-DD`); brak = bez zmian od publikacji. */
  readonly updatedAt?: string;
  readonly translations: Record<Locale, GuideTranslation>;
}

/** Wpis na liście poradników (rozwiązany do jednego języka, bez treści). */
export interface GuideListEntry {
  readonly slug: string;
  readonly category: GuideCategory;
  readonly publishedAt: string;
  /** Szacowany czas czytania wersji w TYM języku (wyliczany z treści, min. 1). */
  readonly readingMinutes: number;
  readonly title: string;
  readonly excerpt: string;
}

/** Pełny poradnik rozwiązany do jednego języka (z treścią). */
export interface GuideFull extends GuideListEntry {
  /** Data ostatniej zmiany treści (Article.dateModified); równa publikacji, gdy bez zmian. */
  readonly updatedAt: string;
  readonly body: readonly GuideBlock[];
}

/** Zawęża dowolny string do obsługiwanego `Locale` (fallback: język domyślny). */
function toLocale(locale: string): Locale {
  return (routing.locales as readonly string[]).includes(locale)
    ? (locale as Locale)
    : routing.defaultLocale;
}

/* ---------------------------------------------------------------------------
 * Skróty pomocnicze do budowy bloków treści (czytelność danych niżej).
 * ------------------------------------------------------------------------- */

const h = (text: string): GuideBlock => ({ type: 'heading', text });
const p = (text: string): GuideBlock => ({ type: 'paragraph', text });
const ul = (items: readonly string[]): GuideBlock => ({ type: 'list', items });

/* ---------------------------------------------------------------------------
 * Dane poradników (najnowsze wg `publishedAt` na górze listy).
 * ------------------------------------------------------------------------- */

const GUIDES: readonly Guide[] = [
  {
    slug: 'praca-w-belgii-bez-znajomosci-jezyka',
    category: 'jobSearch',
    publishedAt: '2026-07-15',
    translations: {
      pl: {
        title: 'Jak znaleźć pracę w Belgii bez znajomości języka',
        excerpt:
          'Nie mówisz po niderlandzku ani francusku? W Belgii wciąż możesz szybko znaleźć pracę. Podpowiadamy, w jakich branżach język nie jest barierą i jak zwiększyć swoje szanse.',
        body: [
          p(
            'Brak znajomości niderlandzkiego lub francuskiego to jedna z najczęstszych obaw osób, które przyjeżdżają do Belgii za pracą. Dobra wiadomość: w wielu branżach pracodawcy przyjmują kandydatów bez lokalnego języka, a podstawowe polecenia da się opanować w kilka tygodni.',
          ),
          h('Branże, w których język nie jest przeszkodą'),
          p(
            'Najłatwiej zacząć w sektorach fizycznych i produkcyjnych, gdzie liczą się przede wszystkim ręce do pracy, rzetelność i punktualność. Zespoły są często wielonarodowe, a instrukcje przekazywane w prostej formie lub po angielsku.',
          ),
          ul([
            'Magazyn i logistyka — kompletacja zamówień, obsługa wózków widłowych.',
            'Produkcja — praca przy linii, pakowanie, kontrola prostych parametrów.',
            'Budownictwo — prace ogólnobudowlane, wykończenia, pomoc na budowie.',
            'Sprzątanie — biura, hotele, obiekty przemysłowe.',
            'Rolnictwo i praca sezonowa — zbiory, sortowanie, szklarnie.',
          ]),
          h('Jak zwiększyć swoje szanse'),
          p(
            'Nawet bez znajomości języka warto pokazać, że jesteś gotowy do pracy od zaraz i masz podstawowe uprawnienia. Największą wartością są konkretne umiejętności: prawo jazdy kategorii B lub C, certyfikat VCA (bezpieczeństwo na budowie), doświadczenie na wózku widłowym czy w konkretnym zawodzie.',
          ),
          p(
            'W profilu na Pracuj.be zaznacz języki, które znasz choćby w stopniu podstawowym, oraz swoją dostępność. Wielu pracodawców używa filtra „bez wymogu językowego" — dzięki temu Twoja aplikacja trafia dokładnie tam, gdzie język nie jest wymagany.',
          ),
          h('Ucz się języka od pierwszego dnia'),
          p(
            'Podstawy niderlandzkiego lub francuskiego szybko przełożą się na lepsze stanowiska i wyższe zarobki. W Belgii dostępne są bezpłatne lub tanie kursy dla obcokrajowców (m.in. w ramach programów integracyjnych we Flandrii i Walonii). Nawet 100 słów związanych z Twoją pracą robi ogromną różnicę.',
          ),
          p(
            'Informacje w tym poradniku mają charakter ogólny. Szczegóły dotyczące kursów językowych i programów integracyjnych sprawdź na oficjalnych stronach regionów (Flandria, Walonia, Bruksela).',
          ),
        ],
      },
      nl: {
        title: 'Werk vinden in België zonder de taal te spreken',
        excerpt:
          'Spreek je geen Nederlands of Frans? In veel sectoren in België kun je toch snel aan de slag. Ontdek waar taal geen drempel is.',
        body: [
          p(
            'Geen Nederlands of Frans spreken is een veelvoorkomende zorg, maar in veel sectoren nemen werkgevers kandidaten aan die de lokale taal niet spreken.',
          ),
          h('Sectoren zonder taaldrempel'),
          ul([
            'Magazijn en logistiek',
            'Productie en verpakking',
            'Bouw en afwerking',
            'Schoonmaak',
            'Landbouw en seizoenswerk',
          ]),
          p(
            'Concrete vaardigheden zoals een rijbewijs, een VCA-attest of ervaring met een heftruck vergroten je kansen. Begin vanaf dag één met de basis van de taal.',
          ),
          p(
            'Dit artikel bevat algemene informatie. Controleer details over taalcursussen en inburgeringsprogramma’s op de officiële websites van de gewesten (Vlaanderen, Wallonië, Brussel).',
          ),
        ],
      },
      fr: {
        title: 'Trouver un emploi en Belgique sans parler la langue',
        excerpt:
          'Vous ne parlez ni néerlandais ni français ? Dans de nombreux secteurs en Belgique, vous pouvez tout de même travailler rapidement.',
        body: [
          p(
            "Ne pas parler le néerlandais ou le français est une crainte fréquente, mais de nombreux employeurs recrutent des candidats qui ne parlent pas la langue locale.",
          ),
          h('Secteurs sans barrière linguistique'),
          ul([
            'Entrepôt et logistique',
            'Production et emballage',
            'Construction et finitions',
            'Nettoyage',
            'Agriculture et travail saisonnier',
          ]),
          p(
            "Des compétences concrètes comme un permis de conduire, une attestation VCA ou de l'expérience avec un chariot élévateur augmentent vos chances. Apprenez les bases de la langue dès le premier jour.",
          ),
          p(
            'Cet article contient des informations générales. Vérifiez les détails sur les cours de langue et les parcours d’intégration sur les sites officiels des Régions (Flandre, Wallonie, Bruxelles).',
          ),
        ],
      },
      en: {
        title: 'Finding work in Belgium without speaking the language',
        excerpt:
          "Don't speak Dutch or French? In many sectors in Belgium you can still start working quickly. Here is where language is not a barrier.",
        body: [
          p(
            "Not speaking Dutch or French is a common worry, but in many sectors employers hire candidates who don't speak the local language.",
          ),
          h('Sectors without a language barrier'),
          ul([
            'Warehouse and logistics',
            'Production and packaging',
            'Construction and finishing',
            'Cleaning',
            'Agriculture and seasonal work',
          ]),
          p(
            'Concrete skills such as a driving licence, a VCA certificate or forklift experience boost your chances. Start learning the basics of the language from day one.',
          ),
          p(
            'This article contains general information. Check the details of language courses and integration programmes on the official websites of the regions (Flanders, Wallonia, Brussels).',
          ),
        ],
      },
    },
  },
  {
    slug: 'umowa-interim-co-warto-wiedziec',
    category: 'contracts',
    publishedAt: '2026-07-08',
    translations: {
      pl: {
        title: 'Umowa interim — co warto wiedzieć',
        excerpt:
          'Praca tymczasowa (interim) to najczęstszy sposób wejścia na belgijski rynek pracy. Wyjaśniamy, jak działa agencja, jakie masz prawa i na co zwracać uwagę.',
        body: [
          p(
            'Interim, czyli praca tymczasowa, to w Belgii bardzo popularny model zatrudnienia — szczególnie na start. Agencja pracy tymczasowej (uitzendbureau / agence intérim) jest Twoim formalnym pracodawcą i to ona wypłaca Ci wynagrodzenie, mimo że pracujesz w firmie klienta.',
          ),
          h('Jak to działa'),
          p(
            'Podpisujesz umowę z agencją, a ona kieruje Cię do przedsiębiorstwa, które potrzebuje pracownika. Umowy interim bywają zawierane nawet na tydzień lub na konkretne zlecenie, ale często są przedłużane, a wiele osób po okresie interim przechodzi na stałą umowę u klienta.',
          ),
          h('Twoje prawa'),
          p(
            'Jako pracownik tymczasowy masz w Belgii takie same podstawowe prawa jak pracownik zatrudniony bezpośrednio na tym samym stanowisku.',
          ),
          ul([
            'Wynagrodzenie nie niższe niż stałego pracownika na tym samym stanowisku.',
            'Wypłata dodatków zmianowych, za nadgodziny i pracę w nocy, jeśli przysługują.',
            'Prawo do ekwiwalentu za urlop i tzw. premii końcoworocznej (przy odpowiednim stażu).',
            'Ubezpieczenie i zgłoszenie do systemu (Dimona) przez agencję.',
          ]),
          h('Na co zwracać uwagę'),
          p(
            'Zawsze proś o pisemną umowę i przechowuj paski wypłat (fiches de paie / loonbrief). Sprawdzaj stawkę godzinową, liczbę przepracowanych godzin i czy odprowadzane są składki. Uważaj na oferty „na czarno" bez rejestracji — to ryzyko braku ubezpieczenia i utraty prawa do świadczeń.',
          ),
          p(
            'Zachowaj kopie wszystkich dokumentów. W razie wątpliwości co do rozliczeń możesz zwrócić się do związku zawodowego lub inspekcji pracy. Ten poradnik ma charakter ogólny — szczegóły potwierdź w oficjalnych źródłach.',
          ),
        ],
      },
      nl: {
        title: 'Interimwerk — wat je moet weten',
        excerpt:
          'Uitzendwerk is de meest voorkomende manier om de Belgische arbeidsmarkt te betreden. Zo werkt het uitzendbureau en dit zijn je rechten.',
        body: [
          p(
            'Bij interimwerk is het uitzendbureau je formele werkgever en betaalt het jouw loon, ook al werk je bij een klant.',
          ),
          h('Je rechten'),
          ul([
            'Hetzelfde loon als een vaste werknemer in dezelfde functie',
            'Ploegen-, overuren- en nachttoeslagen indien van toepassing',
            'Recht op vakantiegeld en een eindejaarspremie (bij voldoende anciënniteit)',
            'Aangifte via Dimona door het bureau',
          ]),
          p(
            'Vraag altijd een schriftelijk contract en bewaar je loonbrieven. Pas op voor werk zonder aangifte.',
          ),
          p(
            'Bewaar kopieën van al je documenten. Heb je twijfels over je loon, dan kun je terecht bij een vakbond of de arbeidsinspectie. Dit artikel bevat algemene informatie — controleer de details bij officiële bronnen.',
          ),
        ],
      },
      fr: {
        title: "Le contrat intérim — ce qu'il faut savoir",
        excerpt:
          "Le travail intérimaire est la façon la plus courante d'entrer sur le marché belge. Voici comment fonctionne l'agence et quels sont vos droits.",
        body: [
          p(
            "En intérim, l'agence est votre employeur officiel et vous paie, même si vous travaillez chez un client.",
          ),
          h('Vos droits'),
          ul([
            'Le même salaire qu’un travailleur permanent au même poste',
            'Primes d’équipe, heures supplémentaires et travail de nuit le cas échéant',
            'Droit au pécule de vacances et à la prime de fin d’année (selon l’ancienneté requise)',
            'Déclaration Dimona par l’agence',
          ]),
          p(
            'Demandez toujours un contrat écrit et conservez vos fiches de paie. Méfiez-vous du travail non déclaré.',
          ),
          p(
            'Conservez une copie de tous vos documents. En cas de doute sur votre salaire, vous pouvez vous adresser à un syndicat ou à l’inspection du travail. Cet article contient des informations générales — vérifiez les détails auprès des sources officielles.',
          ),
        ],
      },
      en: {
        title: 'The interim (temp) contract — what to know',
        excerpt:
          'Temporary (interim) work is the most common way to enter the Belgian labour market. Here is how the agency works and what your rights are.',
        body: [
          p(
            'With interim work the temp agency is your formal employer and pays your wage, even though you work at a client company.',
          ),
          h('Your rights'),
          ul([
            'The same pay as a permanent worker in the same role',
            'Shift, overtime and night allowances where applicable',
            'Right to holiday pay and an end-of-year bonus (once you have worked long enough)',
            'Dimona registration handled by the agency',
          ]),
          p(
            'Always ask for a written contract and keep your payslips. Beware of undeclared work.',
          ),
          p(
            'Keep copies of all your documents. If you have doubts about your pay, you can contact a trade union or the labour inspectorate. This article contains general information — check the details with official sources.',
          ),
        ],
      },
    },
  },
  {
    slug: 'zakwaterowanie-od-pracodawcy',
    category: 'housing',
    publishedAt: '2026-06-28',
    translations: {
      pl: {
        title: 'Zakwaterowanie od pracodawcy — na co uważać',
        excerpt:
          'Wielu pracodawców w Belgii oferuje nocleg. To duże ułatwienie na start, ale warto znać zasady, koszty i swoje prawa, zanim się zgodzisz.',
        body: [
          p(
            'Zakwaterowanie zapewniane przez pracodawcę lub agencję to częsta oferta przy pracy sezonowej, w budownictwie i logistyce. Dla osoby, która dopiero przyjeżdża do Belgii, to wygodne rozwiązanie — nie musisz od razu szukać mieszkania i podpisywać długiej umowy najmu.',
          ),
          h('Zapytaj o szczegóły przed przyjazdem'),
          p('Zanim przyjmiesz ofertę z noclegiem, ustal jasno warunki.'),
          ul([
            'Ile dokładnie kosztuje zakwaterowanie i czy kwota jest odliczana z wypłaty.',
            'Ile osób mieszka w pokoju i jak wyposażone jest mieszkanie.',
            'Czy w cenie są media (prąd, ogrzewanie, woda, internet).',
            'Jak daleko jest do miejsca pracy i czy zapewniony jest transport.',
            'Co dzieje się z noclegiem, gdy zakończysz pracę lub zachorujesz.',
          ]),
          h('Twoje prawa'),
          p(
            'Potrącenia za zakwaterowanie z wynagrodzenia są w Belgii uregulowane i nie mogą być dowolne — pracodawca nie może pobierać zawyżonych kwot ani uzależniać dachu nad głową od rezygnacji z Twoich praw. Warunki powinny być opisane na piśmie, a koszt widoczny na pasku wypłaty.',
          ),
          p(
            'Uważaj na sytuacje, w których nocleg jest powiązany z pracą w sposób, który utrudnia odejście (np. bardzo krótki termin na wyprowadzkę). Zawsze zachowaj możliwość kontaktu i dokumenty.',
          ),
          p(
            'Ten artykuł ma charakter informacyjny. Dokładne limity potrąceń i standardy zakwaterowania potwierdź u związku zawodowego, w agencji lub w oficjalnych źródłach.',
          ),
        ],
      },
      nl: {
        title: 'Huisvesting via de werkgever — waar op letten',
        excerpt:
          'Veel werkgevers in België bieden logies aan. Handig bij de start, maar ken de regels en kosten voordat je akkoord gaat.',
        body: [
          p(
            'Huisvesting via de werkgever of het uitzendbureau is gebruikelijk bij seizoenswerk, bouw en logistiek.',
          ),
          h('Vraag vooraf naar'),
          ul([
            'De exacte kostprijs en of die van het loon wordt afgehouden',
            'Aantal personen per kamer en de uitrusting',
            'Of nutsvoorzieningen inbegrepen zijn',
            'Afstand tot het werk en vervoer',
          ]),
          p('Inhoudingen voor logies zijn wettelijk geregeld en moeten op je loonbrief staan.'),
          p(
            'Dit artikel bevat algemene informatie. Controleer de precieze grenzen voor inhoudingen en de normen voor huisvesting bij een vakbond, het uitzendbureau of officiële bronnen.',
          ),
        ],
      },
      fr: {
        title: "Le logement fourni par l'employeur — points d'attention",
        excerpt:
          "De nombreux employeurs en Belgique proposent un logement. Pratique au début, mais connaissez les règles et les coûts avant d'accepter.",
        body: [
          p(
            "Le logement fourni par l'employeur ou l'agence est courant dans le travail saisonnier, la construction et la logistique.",
          ),
          h('Demandez à l’avance'),
          ul([
            'Le coût exact et s’il est déduit du salaire',
            'Le nombre de personnes par chambre et l’équipement',
            'Si les charges sont comprises',
            'La distance jusqu’au travail et le transport',
          ]),
          p('Les retenues pour logement sont encadrées par la loi et doivent figurer sur la fiche de paie.'),
          p(
            'Cet article contient des informations générales. Vérifiez les limites exactes des retenues et les normes de logement auprès d’un syndicat, de l’agence ou des sources officielles.',
          ),
        ],
      },
      en: {
        title: 'Employer-provided housing — what to watch for',
        excerpt:
          'Many employers in Belgium offer accommodation. Handy at the start, but know the rules and costs before you agree.',
        body: [
          p(
            'Housing provided by the employer or agency is common in seasonal work, construction and logistics.',
          ),
          h('Ask in advance'),
          ul([
            'The exact cost and whether it is deducted from your wage',
            'Number of people per room and the facilities',
            'Whether utilities are included',
            'Distance to work and transport',
          ]),
          p('Deductions for housing are regulated by law and must appear on your payslip.'),
          p(
            'This article contains general information. Check the exact limits on deductions and the housing standards with a trade union, the agency or official sources.',
          ),
        ],
      },
    },
  },
  {
    slug: 'numer-niss-i-podatki',
    category: 'admin',
    publishedAt: '2026-06-18',
    translations: {
      pl: {
        title: 'Numer rejestrowy (NISS) i podatki w Belgii',
        excerpt:
          'NISS to Twój belgijski numer identyfikacyjny, potrzebny przy zatrudnieniu. Wyjaśniamy, czym jest, jak go uzyskać (także gdy nie masz go jeszcze) i jak działa opodatkowanie.',
        body: [
          p(
            'Numer rejestru krajowego (NISS / rijksregisternummer / numéro de registre national) to podstawowy numer identyfikacyjny w Belgii. Działa podobnie do numeru identyfikacyjnego w innych krajach i jest potrzebny przy zatrudnieniu, ubezpieczeniu, kontaktach z administracją i bankiem.',
          ),
          h('Jak uzyskać NISS'),
          p(
            'Numer nadawany jest przy rejestracji w gminie (gemeente / commune) miejsca zamieszkania albo przez pracodawcę/administrację przy pierwszym zatrudnieniu. Zwykle potrzebujesz:',
          ),
          ul([
            'ważnego dokumentu tożsamości (dowód lub paszport),',
            'adresu zamieszkania w Belgii,',
            'umowy o pracę lub dokumentu potwierdzającego zatrudnienie,',
            'w niektórych przypadkach zaświadczenia o zameldowaniu.',
          ]),
          p(
            'Jeśli nie jesteś wpisany do rejestru krajowego, zamiast NISS otrzymujesz numer BIS. O jego nadanie zwykle występuje pracodawca lub jego biuro kadrowe, więc brak NISS nie oznacza, że nie możesz przyjąć oferty.',
          ),
          h('Podatki od wynagrodzenia'),
          p(
            'W Belgii pracodawca co miesiąc pobiera z wynagrodzenia zaliczkę na podatek dochodowy (précompte professionnel / bedrijfsvoorheffing) oraz składki na ubezpieczenia społeczne. Na pasku wypłaty zobaczysz różnicę między kwotą brutto a netto.',
          ),
          p(
            'Raz w roku składa się roczne zeznanie podatkowe. Belgia stosuje progresywną skalę — im wyższy dochód, tym wyższa stawka. Dzięki kwotom wolnym i ulgom część osób odzyskuje nadpłacony podatek.',
          ),
          h('O czym pamiętać'),
          ul([
            'Zachowuj wszystkie paski wypłat i roczne zestawienie (fiche 281.10).',
            'Zgłaszaj zmianę adresu w gminie — wpływa to na dokumenty i rozliczenia.',
            'Jeśli pracujesz też w innym kraju, sprawdź zasady unikania podwójnego opodatkowania.',
          ]),
          p(
            'To ogólne wprowadzenie. Indywidualną sytuację podatkową potwierdź w urzędzie (SPF Finances / FOD Financiën) lub u doradcy — zasady i stawki mogą się zmieniać.',
          ),
        ],
      },
      nl: {
        title: 'Rijksregisternummer (INSZ) en belastingen in België',
        excerpt:
          'Het INSZ-nummer is je Belgische identificatienummer, nodig om te werken. Wat het is en hoe je het krijgt, ook als je het nog niet hebt.',
        body: [
          p(
            'Het rijksregisternummer (INSZ-nummer) is het basisidentificatienummer in België, nodig voor werk, verzekering en administratie.',
          ),
          h('Hoe krijg je het'),
          ul([
            'Een geldig identiteitsbewijs',
            'Een adres in België',
            'Een arbeidsovereenkomst of bewijs van tewerkstelling',
          ]),
          p(
            'Sta je niet in het rijksregister, dan krijg je in plaats daarvan een BIS-nummer. Dat vraagt meestal je werkgever of zijn sociaal secretariaat aan, dus zonder INSZ-nummer kun je een vacature toch aanvaarden.',
          ),
          p(
            'Je werkgever houdt maandelijks bedrijfsvoorheffing en sociale bijdragen in. Eén keer per jaar dien je een belastingaangifte in. Bewaar al je loonbrieven.',
          ),
          p(
            'Dit artikel bevat algemene informatie. Controleer je persoonlijke belastingsituatie bij de FOD Financiën of een adviseur — regels en tarieven kunnen veranderen.',
          ),
        ],
      },
      fr: {
        title: 'Le numéro de registre national (NISS) et les impôts en Belgique',
        excerpt:
          "Le NISS est votre numéro d'identification belge, nécessaire pour travailler. Ce qu'il est et comment l'obtenir, même si vous ne l'avez pas encore.",
        body: [
          p(
            "Le numéro de registre national (NISS) est le numéro d'identification de base en Belgique, nécessaire pour le travail, l'assurance et l'administration.",
          ),
          h('Comment l’obtenir'),
          ul([
            "Une pièce d'identité valable",
            'Une adresse en Belgique',
            'Un contrat de travail ou une preuve d’emploi',
          ]),
          p(
            'Si vous n’êtes pas inscrit au registre national, vous recevez à la place un numéro BIS. Il est généralement demandé par l’employeur ou son secrétariat social : l’absence de NISS ne vous empêche donc pas d’accepter une offre.',
          ),
          p(
            "Votre employeur retient chaque mois le précompte professionnel et les cotisations sociales. Une fois par an, vous introduisez une déclaration d'impôts. Conservez toutes vos fiches de paie.",
          ),
          p(
            'Cet article contient des informations générales. Vérifiez votre situation fiscale personnelle auprès du SPF Finances ou d’un conseiller — les règles et les taux peuvent changer.',
          ),
        ],
      },
      en: {
        title: 'The national number (NISS) and taxes in Belgium',
        excerpt:
          "The NISS is your Belgian identification number, needed for work. What it is and how to get it, even if you don't have one yet.",
        body: [
          p(
            'The national register number (NISS) is the basic identification number in Belgium, needed for work, insurance and administration.',
          ),
          h('How to get it'),
          ul([
            'A valid identity document',
            'An address in Belgium',
            'An employment contract or proof of employment',
          ]),
          p(
            'If you are not in the national register, you receive a BIS number instead. It is usually requested by your employer or its payroll office, so not having a NISS does not stop you from accepting a job offer.',
          ),
          p(
            'Your employer deducts withholding tax on wages and social contributions each month. Once a year you file a tax return. Keep all your payslips.',
          ),
          p(
            'This article contains general information. Check your personal tax situation with the FPS Finance (SPF Finances / FOD Financiën) or an adviser — rules and rates may change.',
          ),
        ],
      },
    },
  },
  {
    slug: 'prawo-jazdy-i-praca-kierowcy',
    category: 'driving',
    publishedAt: '2026-06-05',
    translations: {
      pl: {
        title: 'Prawo jazdy i praca kierowcy w Belgii',
        excerpt:
          'Kierowcy są w Belgii bardzo poszukiwani. Sprawdź, jakie uprawnienia są potrzebne, czym jest kod 95 i jak wygląda praca za kółkiem.',
        body: [
          p(
            'Transport i logistyka to jedne z najbardziej chłonnych branż na belgijskim rynku pracy. Jeśli masz prawo jazdy, Twoje szanse na szybkie znalezienie pracy — także bez znajomości języka — znacząco rosną.',
          ),
          h('Kategorie prawa jazdy'),
          ul([
            'Kategoria B — samochody osobowe i dostawcze do 3,5 t (kurier, dostawy, praca z własnym autem).',
            'Kategoria C — samochody ciężarowe powyżej 3,5 t.',
            'Kategoria C+E — ciężarówka z przyczepą / zestaw (najbardziej poszukiwane w transporcie międzynarodowym).',
          ]),
          h('Kod 95 i karta kierowcy'),
          p(
            'Do zawodowego przewozu rzeczy potrzebny jest kod 95, czyli świadectwo kwalifikacji zawodowej (CPC), które utrzymuje się przez okresowe szkolenia. Do rejestracji czasu pracy służy karta kierowcy do tachografu. Polskie prawo jazdy jest w Belgii uznawane, ale w niektórych przypadkach warto je wymienić na belgijskie po zameldowaniu.',
          ),
          h('Czego oczekują pracodawcy'),
          ul([
            'Aktualnych uprawnień odpowiedniej kategorii i ważnego kodu 95.',
            'Karty kierowcy oraz świadomości przepisów o czasie pracy i odpoczynku.',
            'Doświadczenia w danym typie transportu (dystrybucja, plac, międzynarodowy).',
            'Punktualności i dbałości o pojazd oraz dokumenty przewozowe.',
          ]),
          p(
            'Uznawanie uprawnień i wymogi kodu 95 mogą się różnić w zależności od sytuacji. Szczegóły potwierdź w urzędzie transportu (SPF Mobilité / FOD Mobiliteit) lub u pracodawcy. Ten poradnik ma charakter ogólny.',
          ),
        ],
      },
      nl: {
        title: 'Rijbewijs en werken als chauffeur in België',
        excerpt:
          'Chauffeurs zijn in België erg gevraagd. Ontdek welke rijbewijzen nodig zijn en wat code 95 inhoudt.',
        body: [
          p(
            'Transport en logistiek behoren tot de sectoren met de meeste vacatures in België. Met een rijbewijs stijgen je kansen sterk.',
          ),
          h('Rijbewijscategorieën'),
          ul([
            'B — wagens tot 3,5 t',
            'C — vrachtwagens boven 3,5 t',
            'C+E — vrachtwagen met aanhangwagen',
          ]),
          p(
            'Voor beroepsvervoer heb je code 95 (vakbekwaamheid) en een bestuurderskaart voor de tachograaf nodig.',
          ),
          p(
            'De erkenning van rijbewijzen en de vereisten voor code 95 kunnen per situatie verschillen. Controleer de details bij de FOD Mobiliteit of je werkgever. Dit artikel bevat algemene informatie.',
          ),
        ],
      },
      fr: {
        title: 'Le permis de conduire et le métier de chauffeur en Belgique',
        excerpt:
          'Les chauffeurs sont très recherchés en Belgique. Découvrez quels permis sont nécessaires et ce qu’est le code 95.',
        body: [
          p(
            'Le transport et la logistique comptent parmi les secteurs qui recrutent le plus en Belgique. Avec un permis, vos chances augmentent fortement.',
          ),
          h('Catégories de permis'),
          ul([
            'B — véhicules jusqu’à 3,5 t',
            'C — camions de plus de 3,5 t',
            'C+E — camion avec remorque',
          ]),
          p(
            'Pour le transport professionnel, il faut le code 95 (aptitude professionnelle) et une carte de conducteur pour le tachygraphe.',
          ),
          p(
            'La reconnaissance des permis et les exigences du code 95 peuvent varier selon la situation. Vérifiez les détails auprès du SPF Mobilité ou de votre employeur. Cet article contient des informations générales.',
          ),
        ],
      },
      en: {
        title: 'Driving licence and working as a driver in Belgium',
        excerpt:
          'Drivers are in high demand in Belgium. Learn which licences you need and what code 95 is.',
        body: [
          p(
            'Transport and logistics are among the sectors with the most vacancies in Belgium. A driving licence strongly boosts your chances.',
          ),
          h('Licence categories'),
          ul([
            'B — vehicles up to 3.5 t',
            'C — trucks over 3.5 t',
            'C+E — truck with trailer',
          ]),
          p(
            'For professional transport you need code 95 (professional competence) and a driver card for the tachograph.',
          ),
          p(
            'Recognition of licences and the code 95 requirements can differ depending on your situation. Check the details with the FPS Mobility (SPF Mobilité / FOD Mobiliteit) or your employer. This article contains general information.',
          ),
        ],
      },
    },
  },
  {
    slug: 'bezpieczenstwo-na-budowie-vca',
    category: 'safety',
    publishedAt: '2026-05-22',
    translations: {
      pl: {
        title: 'Bezpieczeństwo na budowie i certyfikat VCA',
        excerpt:
          'VCA to w Belgii praktycznie przepustka do pracy na budowie i w przemyśle. Wyjaśniamy, czym jest, jak zdobyć certyfikat i jakich zasad przestrzegać.',
        body: [
          p(
            'Praca na budowie i w zakładach przemysłowych wiąże się z ryzykiem, dlatego bezpieczeństwo traktuje się w Belgii bardzo poważnie. Coraz częściej warunkiem wejścia na teren budowy jest posiadanie certyfikatu VCA.',
          ),
          h('Czym jest VCA'),
          p(
            'VCA (Veiligheid, Gezondheid en Milieu Checklist Aannemers) to certyfikat potwierdzający podstawową wiedzę z zakresu bezpieczeństwa, zdrowia i ochrony środowiska. Dla pracowników fizycznych wystarcza zwykle poziom podstawowy (VCA Basis / VCA-VOL dla osób kierujących).',
          ),
          h('Jak zdobyć certyfikat'),
          p(
            'Certyfikat uzyskuje się po krótkim szkoleniu i zdaniu egzaminu. Materiały i egzamin dostępne są w kilku językach, często także po polsku. Certyfikat jest ważny przez określony czas (zwykle kilka lat), po czym trzeba go odnowić.',
          ),
          h('Podstawowe zasady na budowie'),
          ul([
            'Zawsze noś środki ochrony osobistej: kask, buty, kamizelkę, w razie potrzeby okulary i rękawice.',
            'Stosuj się do oznaczeń i wygrodzeń stref niebezpiecznych.',
            'Nie obsługuj maszyn, do których nie masz uprawnień.',
            'Zgłaszaj wypadki i sytuacje niebezpieczne przełożonemu.',
            'Utrzymuj porządek — większość wypadków to poślizgnięcia i upadki.',
          ]),
          p(
            'Wymogi mogą różnić się w zależności od firmy i placu budowy. Szczegóły dotyczące szkoleń VCA potwierdź u pracodawcy lub akredytowanego ośrodka. Ten artykuł ma charakter ogólny.',
          ),
        ],
      },
      nl: {
        title: 'Veiligheid op de bouwplaats en het VCA-attest',
        excerpt:
          'VCA is in België vrijwel een toegangsbewijs voor werk op de bouw en in de industrie. Wat het is en hoe je het behaalt.',
        body: [
          p(
            'Werk op de bouw en in de industrie brengt risico’s mee, daarom is veiligheid in België erg belangrijk. Vaak is een VCA-attest verplicht.',
          ),
          h('Wat is VCA'),
          p(
            'VCA bevestigt basiskennis over veiligheid, gezondheid en milieu. Voor arbeiders volstaat meestal VCA Basis.',
          ),
          h('Basisregels'),
          ul([
            'Draag altijd persoonlijke beschermingsmiddelen',
            'Volg de signalisatie en afbakeningen',
            'Bedien geen machines zonder bevoegdheid',
            'Meld ongevallen en gevaarlijke situaties',
          ]),
          p(
            'De vereisten kunnen per bedrijf en per bouwplaats verschillen. Controleer de details over VCA-opleidingen bij je werkgever of een erkend opleidingscentrum. Dit artikel bevat algemene informatie.',
          ),
        ],
      },
      fr: {
        title: 'La sécurité sur le chantier et le certificat VCA',
        excerpt:
          'Le VCA est en Belgique quasiment un laissez-passer pour travailler sur les chantiers et dans l’industrie. Ce qu’il est et comment l’obtenir.',
        body: [
          p(
            'Le travail sur chantier et dans l’industrie comporte des risques ; la sécurité est donc très importante en Belgique. Le certificat VCA est souvent exigé.',
          ),
          h('Qu’est-ce que le VCA'),
          p(
            'Le VCA atteste des connaissances de base en sécurité, santé et environnement. Pour les ouvriers, le niveau VCA Base suffit généralement.',
          ),
          h('Règles de base'),
          ul([
            'Portez toujours les équipements de protection',
            'Respectez la signalisation et les délimitations',
            'N’utilisez pas de machines sans habilitation',
            'Signalez les accidents et situations dangereuses',
          ]),
          p(
            'Les exigences peuvent varier selon l’entreprise et le chantier. Vérifiez les détails des formations VCA auprès de votre employeur ou d’un centre agréé. Cet article contient des informations générales.',
          ),
        ],
      },
      en: {
        title: 'Construction site safety and the VCA certificate',
        excerpt:
          'In Belgium the VCA is virtually a pass to work on construction sites and in industry. What it is and how to get it.',
        body: [
          p(
            'Work on construction sites and in industry involves risk, so safety is taken very seriously in Belgium. A VCA certificate is often required.',
          ),
          h('What is VCA'),
          p(
            'VCA confirms basic knowledge of safety, health and the environment. For manual workers the VCA Basic level is usually enough.',
          ),
          h('Basic rules'),
          ul([
            'Always wear personal protective equipment',
            'Follow signage and marked-off zones',
            'Do not operate machines without authorisation',
            'Report accidents and dangerous situations',
          ]),
          p(
            'Requirements can differ between companies and sites. Check the details of VCA training with your employer or an accredited training centre. This article contains general information.',
          ),
        ],
      },
    },
  },
];

/* ---------------------------------------------------------------------------
 * Publiczne API (kontrakt @/lib/guides/guides)
 * ------------------------------------------------------------------------- */

/**
 * Tempo czytania użyte do szacowania czasu (słowa/min). Wartość zachowawcza dla czytelnika,
 * który czyta w drugim języku; ta sama dla wszystkich języków, by różnice wynikały z treści.
 */
const WORDS_PER_MINUTE = 200;

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Czas czytania liczony z treści danej wersji językowej (tytuł + zajawka + bloki).
 * Wersje nl/fr/en są skrócone, więc stała wartość na poradnik zawyżałaby ich czas.
 */
function readingMinutesOf(translation: GuideTranslation): number {
  const words = [
    translation.title,
    translation.excerpt,
    ...translation.body.flatMap((block) => (block.type === 'list' ? block.items : [block.text])),
  ].reduce((sum, text) => sum + countWords(text), 0);
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}

function newestFirst(a: Guide, b: Guide): number {
  return b.publishedAt.localeCompare(a.publishedAt);
}

/** Wszystkie poradniki rozwiązane do jednego języka (bez treści), od najnowszych. */
export function getAllGuides(locale: string): GuideListEntry[] {
  const resolved = toLocale(locale);
  return [...GUIDES].sort(newestFirst).map((guide) => {
    const t = guide.translations[resolved];
    return {
      slug: guide.slug,
      category: guide.category,
      publishedAt: guide.publishedAt,
      readingMinutes: readingMinutesOf(t),
      title: t.title,
      excerpt: t.excerpt,
    };
  });
}

/** Pełny poradnik (z treścią) po slugu, rozwiązany do języka. `null`, gdy nieznany slug. */
export function getGuideBySlug(slug: string, locale: string): GuideFull | null {
  const guide = GUIDES.find((item) => item.slug === slug);
  if (!guide) return null;
  const t = guide.translations[toLocale(locale)];
  return {
    slug: guide.slug,
    category: guide.category,
    publishedAt: guide.publishedAt,
    updatedAt: guide.updatedAt ?? guide.publishedAt,
    readingMinutes: readingMinutesOf(t),
    title: t.title,
    excerpt: t.excerpt,
    body: t.body,
  };
}

/** Wszystkie slugi (dla `generateStaticParams`). */
export function getAllGuideSlugs(): string[] {
  return GUIDES.map((guide) => guide.slug);
}
