# VDAB — dostęp do API ofert pracy (research, #94)

Stan: 24 września 2026. Wszystkie źródła odczytano 24.09.2026 (data dostępu
podana raz, dotyczy każdego linku w tym dokumencie). Dokument jest researchem,
nie decyzją ani poradą prawną. Nie zawiera credentiali ani danych VDAB. Nie
towarzyszy mu żaden kod, migracja ani zmiana workflow — zgodnie z kryteriami
[#94](https://github.com/aktualnosci-be/pracujbe/issues/94) implementacja
powstaje dopiero po pisemnej decyzji „go” i w osobnych, małych issues.

Oznaczenia: **[F]** — fakt z oficjalnego źródła (link obok), **[P]** —
przypuszczenie lub interpretacja do potwierdzenia z VDAB, **[R]** —
rekomendacja dla Pracuj.be.

## 1. Podsumowanie i rekomendacje go/no-go

| Produkt VDAB         | Do czego                               | Stan dostępu                                                            | Rekomendacja                                                                                      |
| -------------------- | -------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Competent 2 API      | taksonomia zawodów i kompetencji       | open data, samoobsługa, bezpłatnie [F]                                  | **GO warunkowe** na osobne issue importu słownika (offline, wersjonowany), po decyzji właściciela |
| Vacature API         | pobieranie ofert VDAB                  | **nowe wnioski czasowo wstrzymane** [F]; wymaga partnerstwa i umowy [F] | **NO-GO teraz.** Właściciel pyta VDAB o termin wznowienia i warunki (sekcja 6)                    |
| Vacature Posting API | publikowanie własnych ofert na vdab.be | dla pracodawców z siedzibą w EOG, umowa + testy [F]                     | **NO-GO teraz** — nie jest źródłem ofert; ewentualnie później jako funkcja „opublikuj też w VDAB” |

Najważniejsze ustalenia:

- VDAB na stronie Vacature API pisze: „Omwille van de vele aanvragen kan
  tijdelijk geen nieuwe aanvraag ingediend worden.” [F][vac] — dziś nie da się
  złożyć wniosku o Vacature API.
- Vacature API jest bezpłatne, ale VDAB prosi o podanie VDAB jako źródła:
  „Deze API is gratis. We vragen je wel om VDAB als bron te vermelden.” [F][dx]
- Dostęp tylko po zatwierdzeniu partnerstwa i podpisaniu umowy o współpracy,
  wyłącznie do celów zawodowych i gdy wymiana ma wartość dodaną dla obu stron
  [F][vac][dx]. Treść umowy dla Vacature API **nie jest publiczna** — publiczny
  jest tylko wzór umowy dla Posting API [F][onb].
- Brak publicznych warunków dot. tłumaczenia treści ofert, okresu
  przechowywania, SEO (JobPosting) i obowiązków usuwania — to pytania do VDAB
  (sekcja 6). Nie zakładamy ich treści.

## 2. Vacature API — fakty

### Warunki dostępu

- „Je mag de Vacature API gebruiken, nadat VDAB een partnership met jou heeft
  goedgekeurd en na het ondertekenen van een samenwerkingsovereenkomst.” [F][vac]
- „Je mag de Vacature API enkel voor professionele doeleinden gebruiken.”
  Wymiana „moet een toegevoegde waarde hebben voor VDAB en voor je organisatie.”
  [F][vac]
- Oferty i profile obywateli to „data met gebruiksbeperkingen” — „niet vrij
  beschikbaar en mag je enkel onder specifieke voorwaarden gebruiken.” [F][onb]
- Koszt: „gratis”; wymóg podania VDAB jako źródła (cytat wyżej) [F][dx].
- Formularz wniosku jest tylko dla organizacji; pyta m.in. o nazwę firmy, typ
  (np. pracodawca, agencja, rekruter, **jobsite**, dostawca oprogramowania),
  numer KBO/VAT, członkostwo w Federgon, osobę kontaktową i cel wymiany
  [F][form]. Wniosek o Vacature API jest obecnie wstrzymany [F][vac].

### Proces (gdy wnioski zostaną wznowione)

Według strony onboardingu dla danych z ograniczeniami [F][onb]:

1. Wniosek → krótka rozmowa zapoznawcza z API Center of Excellence (CoE).
2. Przy pozytywnym wyniku — „waar nodig” — umowa o współpracy do podpisu.
3. Link do aktywacji konta w portalu deweloperskim, rejestracja aplikacji,
   wniosek o subskrypcję API; CoE decyduje o powiązaniu API z aplikacją i
   wysyła e-mail z decyzją.

Instrukcja dostępu (PDF, czerwiec 2026) [F][pdf-access]:

- Rejestracja aplikacji w `developer.vdab.be/openservices` generuje klucz API i
  sekret (sekret pokazywany tylko raz).
- Dla API chronionych OIDC VDAB przekazuje Client ID i Client Secret linkiem
  ważnym 7 dni na **imienny adres technicznego SPOC** (bez adresu ogólnego ani
  listy dystrybucyjnej).
- VDAB wymaga przechowywania credentiali w rozwiązaniu do zarządzania sekretami
  zgodnym z aktualnymi standardami (przykłady: HashiCorp Vault, AWS Secrets
  Manager, Azure Key Vault, GCP Secret Manager — lista niewyczerpująca) i
  natychmiastowego zgłoszenia wycieku lub podejrzenia wycieku na
  `ict_iam@vdab.be` i `security@vdab.be`.

Zmiana od października 2026 [F][news]: VDAB przenosi logowanie do portalu
deweloperskiego na nowe zarządzanie tożsamością z MFA; akceptowane są tylko
firmowe adresy e-mail (nie Gmail, Skynet). Termin z komunikatu (5.10.2026)
dotyczy administratorów, którzy już korzystają z portalu. [P] Pracuj.be nie ma
dziś konta, więc termin go nie dotyczy, ale przyszły SPOC musi mieć adres w
domenie firmy.

### Technika

Z publicznej strony produktu i specyfikacji OpenAPI 3.0 „Vacatures 4.2.0”
(plik do pobrania bez logowania) [F][vac][dev][spec]:

- Serwer: `https://api.vdab.be/services/openservices/vacatures/v4.2.0`.
- Autoryzacja: nagłówek `X-IBM-Client-Id` (klucz API) + `Authorization: Bearer`
  (JWT z OAuth 2.0 client credentials). Token: `POST
https://{host}/isam/sps/oauth/oauth20/token`, host produkcyjny
  `op-derden.vdab.be`, testowy `op-derden-cbt.vdab.be`; token ważny 900 s
  [F][pdf-access]. Tylko HTTPS, TLS 1.2+ [F][vac].
- Limit planu „Developer”: **2000 wywołań na minutę** na każdy endpoint [F][dev].
- Format: JSON (REST). Licencja w specyfikacji: „VDAB License” — bez treści
  [F][spec].
- Endpointy [F][vac][spec]:

| Endpoint                        | Zachowanie                                                                                                        | Stronicowanie            |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------ |
| `GET /vacatures/initial?datum=` | referencje i status (zawsze `GEPUBLICEERD`) wszystkich ofert opublikowanych na datę                               | `vanaf`, `aantal` ≤ 2000 |
| `GET /vacatures/bulk?van=&tot=` | oferty utworzone/zmienione/usunięte w oknie; **okno maks. 5 dni**                                                 | `vanaf`, `aantal` ≤ 2000 |
| `POST /vacatures`               | szczegóły wielu ofert po liście id (`VacaturesFilter`)                                                            | —                        |
| `GET /vacatures/{id}`           | pełne szczegóły jednej oferty                                                                                     | —                        |
| `GET /vacatures`                | wyszukiwanie z filtrami (jobdomein, postcode, beroep, competentie, afstand…), maks. 5 pól wyniku, `filterDubbels` | `aantal` ≤ 200           |

- Status oferty: `GEPUBLICEERD` / `NIET_GEPUBLICEERD` (zawsze w odpowiedzi
  bulk) [F][spec].
- Identyfikatory: `vacatureReferentie` = `vdabReferentie`, `interneReferentie`,
  `externeReferentie`, `hrxmlReferentie`; `versie` [F][spec].
- Duplikaty: obiekt `dubbels` (`parentId`, `dubbelIds`); `filterDubbels`
  działa „best effort”, z paginacją tylko do 2000 wyników. VDAB definiuje
  dubel jako ofertę, która trafia do VDAB wieloma kanałami (np. job boardy,
  agencje) [F][spec].
- Treść: tytuł, opis, profil zawodu i jobdomeny (Competent), adres pracy z
  geolokalizacją, umowa (typ, reżim, godziny, **min./maks. wynagrodzenie
  brutto**), wymagania (w tym języki z poziomem), dostawca (`leverancier` z KBO
  i typem: zwykła firma / pośrednik / dostawca zewnętrzny), zleceniodawca,
  daty publikacji i depublikacji, sposób aplikowania (formularz WWW, e-mail,
  telefon) i **osoba kontaktowa (imię i nazwisko, telefon, e-mail)** [F][spec].
- Specyfikacja nie ma pola języka treści oferty [F][spec]. [P] Większość ofert
  VDAB jest po niderlandzku; Forem publikuje oferty VDAB tylko w wersji
  przetłumaczonej na francuski [F][odwb], co sugeruje, że wersji FR nie ma
  zawsze.
- Kody słownikowe (jobdomein, studie, beroep…) pochodzą z Referentie API
  [F][vac].

### Zmiany API

Polityka zmian VDAB [F][chg]: zmiany łamiące — min. 2 miesiące zapowiedzi;
niełamiące — min. 2 tygodnie; krytyczne, prawne, bezpieczeństwa i prywatności
— bez zapowiedzi. Stara wersja wspierana 6 miesięcy po nowej. Dodawanie pól
opcjonalnych i zmiana kolejności pól to zmiany niełamiące — parser musi
ignorować nieznane pola.

### Redystrybucja ofert przez VDAB (kontekst)

- VDAB pisze, że oferty z vdab.be trafiają też do serwisów partnerów (m.in.
  Jobat, Werken voor Vlaanderen, Bejobs), do wyników Google, do Forem i Actiris
  oraz do portalu EURES; pracodawca może z tego zrezygnować telefonicznie
  [F][verspr].
- [P] Nie wiadomo, czy Vacature API sam pomija oferty pracodawców, którzy
  wypisali się z partnerów. Pytanie do VDAB (sekcja 6).
- Logo VDAB jest chronionym znakiem; nie wolno go dodawać do własnych ofert;
  przy współpracy wolno promować VDAB oficjalnym logo, pytania na
  `communicatie@vdab.be` [F][disc]. [R] Atrybucja tekstowa „Źródło: VDAB” bez
  logo, dopóki umowa nie stanowi inaczej.

## 3. Vacature Posting API — fakty

- Służy do publikowania ofert z własnego systemu HR na vdab.be; format HR-XML;
  bezpłatne; dla każdego pracodawcy z siedzibą w EOG; oferty muszą spełniać
  wytyczne jakości [F][vps][dx].
- Onboarding: umowa, credentiale testowe w 5 dni roboczych, testy techniczne i
  5–10 ofert testowych (najlepiej w 15 dni), pętla uwag jakości, idealnie do 3
  miesięcy, credentiale produkcyjne w 5 dni roboczych [F][onb].
- Oferta bez okresu publikacji — maks. 60 dni; z okresem — maks. 90 dni; pola
  tekstowe do 4000 znaków i 4000 bajtów; bez linków w polach tekstowych
  [F][vps].
- Wzór umowy (maj 2025) [F][pdf-vps]: art. 4 — przestrzeganie RODO i
  przetwarzanie oraz przechowywanie danych ofert i danych osobowych **na
  serwerach w EOG**; art. 5 — ostrzeżenie i wyłączenie dostępu przy
  naruszeniach, partner odpowiada za prawidłowe użycie danych; art. 7 — umowa
  na rok, automatycznie przedłużana, wypowiedzenie z miesięcznym terminem.
  [P] Umowa dla Vacature API może mieć podobne klauzule (EOG, RODO), ale jej
  treść nie jest publiczna.
- [R] Dla Pracuj.be to przyszła funkcja dla pracodawców („opublikuj też na
  vdab.be”), a nie źródło ofert. Wymagałaby statusu dostawcy oprogramowania lub
  wniosku każdego pracodawcy — osobna decyzja produktowa.

## 4. Competent 2 API — fakty

- „Competent 2-data zijn open data waar geen gebruiksbeperkingen op rusten”;
  API bezpłatne i dostępne dla wszystkich; nie trzeba składać wniosku —
  samoobsługowa subskrypcja w `developer.vdab.be/opendata` z automatyczną
  akceptacją [F][comp][onb][dx].
- Uwierzytelnienie kluczem API, HTTPS/TLS 1.2+ [F][comp].
- Kilka wydań rocznie (np. 3.27 z 25.06.2026 — druga z czterech w 2026);
  endpoint zmian między wydaniami; osobne API konwersji między wersjami
  Competent [F][comp][competent][dev].
- Od 13.01.2026 oferty w VDAB mogą używać kodów Competent 2.0 [F][c20].
- Competent deklaruje powiązanie z ISCO i ESCO; jest wspólnym standardem
  Synerjob (VDAB, Actiris, Bruxelles-Formation, Le Forem, ADG) [F][competent].
- [P] Nie potwierdzono, w jakich językach są etykiety Competent przez API —
  sprawdzić w specyfikacji po subskrypcji.

[R] ESCO (`docs/RESEARCH-TECH.md`) zostaje głównym słownikiem wielojęzycznym
(PL/NL/FR/EN). Competent 2 jest dodatkowym źródłem kodów: tabela mapowań
`competent_code → esco_uri` z wersją wydania, a nie drugi słownik zawodów.
[P] Nie sprawdzono, czy API Competent zwraca gotowe powiązania z ESCO (VDAB
pisze tylko o możliwości powiązania). Jeśli nie — mapowanie trzeba zbudować i
przejrzeć, co jest osobnym kosztem. Mapowanie jest potrzebne do tłumaczenia
kodów z ofert VDAB na nasze etykiety. Import offline, wersjonowany, bez wywołań
w runtime — tak jak ESCO.

## 5. Kontekst: Actiris i Le Forem

- **Le Forem** udostępnia streszczenia opublikowanych ofert jako open data na
  ODWB (bezpłatnie, aktualizowane „w czasie rzeczywistym”) [F][forem-od]. W
  metadanych zbioru jest licencja **CC BY-SA 4.0** i ok. 26 tys. rekordów;
  pola to m.in. tytuł, miejscowość, typ umowy, pracodawca, języki, NACE,
  `source`, `referenceexterne`, `url` i daty emisji [F][odwb-api]. Strona
  Forem pisze też, że dane pozostają „la propriété du Forem” [F][forem-od].
  [P] Forem przejmuje oferty z VDAB (tylko przetłumaczone na FR) [F][odwb] —
  przy dwóch źródłach duplikaty między Forem i VDAB są pewne. [P] CC BY-SA
  (share-alike) może obejmować tłumaczenia jako utwory zależne — przed użyciem
  potrzebna opinia prawna. Forem ma też API do publikowania ofert (bezpłatne, z
  regulaminem) [F][forem-api].
- **Actiris**: na stronie partnerów Actiris nie znaleziono publicznego API ani
  feedu ofert dla serwisów zewnętrznych [F][actiris]. „API” Actiris w
  wyszukiwarkach to zewnętrzne scrapery (np. Apify) — **nie są oficjalnym
  kanałem i nie wolno ich używać**. [R] Zapytać Actiris przez formularz
  kontaktowy dla partnerów.
- VDAB automatycznie przekazuje oferty z vdab.be do Forem i Actiris [F][verspr].
  [P] Nie wiadomo, czy wymiana działa też w drugą stronę, czyli czy Vacature
  API zawiera oferty z Brukseli i Walonii. Do potwierdzenia.

## 6. Co musi zrobić właściciel

1. **Teraz:** napisać do `api.coe@vdab.be` (albo przez formularz
   `extranet.vdab.be/feedback`, tel. 0800 30 700) z pytaniem o termin
   wznowienia wniosków do Vacature API. Opisać use case: publiczny serwis
   ofert pracy dla osób mówiących po polsku, niderlandzku, francusku i
   angielsku, pracujących w Belgii; wartość dla VDAB: dotarcie do obcojęzycznych
   kandydatów, link zwrotny do oferty na vdab.be, podanie VDAB jako źródła.
2. Poprosić o wzór umowy dla Vacature API i pisemne odpowiedzi na pytania:
   - Czy wolno publikować oferty na własnej stronie **w tłumaczeniu** (PL/EN,
     także FR/NL) i z jakim oznaczeniem? Automatyczne tłumaczenie?
   - Jak długo wolno przechowywać ofertę po `NIET_GEPUBLICEERD` / po
     `depublicatieDatum`; w jakim czasie trzeba ją usunąć ze strony?
   - Wymagana forma atrybucji (tekst, link, logo)?
   - Czy wolno emitować `JobPosting` (Google for Jobs) dla ofert VDAB i
     indeksować je, czy wymagany jest `canonical`/noindex?
   - Czy API pomija oferty pracodawców, którzy nie chcą dystrybucji do
     partnerów? Jak zgłaszać żądania usunięcia od pracodawców?
   - Czy wolno pokazywać dane osoby kontaktowej, czy tylko link do aplikowania
     na vdab.be? Role RODO (odrębny administrator?) i wymagane DPA.
   - Czy aplikowanie musi zawsze prowadzić do VDAB/pracodawcy, czy wolno
     przyjmować zgłoszenia w Pracuj.be?
   - Czy wymóg serwerów w EOG obowiązuje; czy zmienne środowiskowe Railway są
     akceptowalnym magazynem sekretów?
   - Oczekiwana częstotliwość synchronizacji i dopuszczalne obciążenie.
3. Po wznowieniu wniosków: formularz [form] (typ organizacji: jobsite; firmowy
   adres SPOC), rozmowa, analiza umowy przez prawnika, podpis.
4. Pisemna decyzja go/no-go w #94 dla każdego z trzech produktów.
5. Competent 2: decyzja o issue importu słownika (nie wymaga umowy; wymaga
   konta w portalu open data z firmowym adresem).

## 7. Integracja techniczna po decyzji „go” (propozycja, nie wdrażać wcześniej)

Każdy punkt to osobne małe issue z testami kontraktowymi opartymi na
publicznym `vacatures_4.2.0.json` (przechowywać tylko wersję i hash, nie treść
ofert).

### Model danych

- `job_sources` (słownik: `vdab`, później `forem`…): nazwa, tekst atrybucji,
  URL, warunki, flagi (np. `allow_translation`, `allow_jobposting` —
  **ustawiane z umowy**, domyślnie `false`).
- `jobs`: `source` (domyślnie `native`), `is_external boolean`, `external_id`
  (= `vdabReferentie`), `external_version` (`versie`), `external_url`,
  `source_synced_at`, `source_unpublished_at`; `unique (source, external_id)`.
- `jobs.company_id` jest dziś `not null` i wiąże ofertę z weryfikacją firmy,
  członkami i RLS. [R] Ofert VDAB nie przypisujemy do firm z Pracuj.be (nie
  są zweryfikowane przez nas). Opcje: `company_id` nullable z CHECK
  `(is_external) or company_id is not null` albo osobna tabela
  `external_jobs` z tym samym widokiem publicznym. Wybór w issue modelu
  danych; w obu przypadkach nazwa i KBO dostawcy (`leverancier`) jako pola
  oferty, nie konto firmy.
- Staging `external_job_imports`: surowy payload (krótka retencja), hash treści,
  stan (`fetched/applied/rejected/unpublished`), kod błędu — import idempotentny
  i audytowalny.
- Strażniki bazy: ofert zewnętrznych nie da się edytować w kreatorze ani przez
  `publish_job`/`save_job_draft`; `apply_to_job` odrzuca ofertę zewnętrzną
  (aplikowanie = link do źródła, dopóki umowa nie pozwoli inaczej); pisze tylko
  service role.

### Synchronizacja

- Klient: token OAuth w pamięci procesu z odnowieniem przed 900 s; własny limit
  znacznie poniżej 2000/min (np. ≤ 5 zapytań/s), backoff przy 429/5xx,
  timeout; sekrety w zmiennych Railway (jeśli VDAB je zaakceptuje), nigdy w
  repo.
- **Initial sync:** `GET /vacatures/initial?datum=now` stronami po 2000 →
  lista id → `POST /vacatures` w partiach → upsert.
- **Incremental:** `GET /vacatures/bulk?van=kursor−zakładka&tot=now` (okno ≤
  5 dni; zakładka np. 15 min na opóźnienia) → dla utworzonych/zmienionych
  szczegóły przez `POST /vacatures`; `NIET_GEPUBLICEERD` → natychmiast ukryć
  (`source_unpublished_at`). Kursor zapisywany dopiero po udanym zapisie
  całego okna. Przerwa > 5 dni → pełny initial.
- **Rekoncyliacja** raz dziennie: `initial` vs nasze aktywne oferty VDAB —
  brakujące ukrywamy (łapie zgubione usunięcia).
- Przedawnienie: niezależnie od API ukrywamy ofertę po `depublicatieDatum`
  (`expire_due_jobs` już zmienia termin na `expired`).
- Uruchamianie: `/api/maintenance` działa co godzinę i wykonuje szybkie RPC w
  `Promise.all`. [R] Sync VDAB wywołuje wiele zapytań HTTP, więc nie wkładać go
  w ten sam `Promise.all`: albo osobny endpoint `/api/integrations/vdab/sync` z
  tym samym schematem autoryzacji i osobnym cronem Railway, albo osobne zadanie
  w `/api/maintenance` z blokadą (advisory lock), limitem czasu i
  kontynuacją od kursora. Błąd sync nie może zatrzymać GC (osobny kod
  statusu w odpowiedzi). Odpowiedź i log tylko z licznikami.
- Wyłącznik: `VDAB_SYNC_ENABLED` — bez niego żadnych wywołań; w trybie demo
  brak.

### Deduplikacja

1. W obrębie VDAB: klucz `(source, external_id)`; z grupy `dubbels`
   importujemy tylko `parentId` (dzieci jako aliasy, nie oferty).
2. Z ofertami natywnymi: best effort — KBO dostawcy/firmy + znormalizowany
   tytuł + kod pocztowy + zbliżone daty. Zbieżność daje flagę do przeglądu,
   niczego nie usuwa automatycznie. Oferta natywna (zweryfikowana firma) ma
   pierwszeństwo na listach.
3. Z Forem (jeśli kiedyś): [P] `referenceexterne`/`source` w zbiorze Forem może
   wskazywać ofertę VDAB — do sprawdzenia na danych przed decyzją.

### Języki

- Oryginał zapisujemy w `job_translations` z wykrytym locale (zwykle `nl`,
  czasem `fr`/`en`) i oznaczeniem, że to tekst źródła.
- PL/EN/FR/NL generujemy przez kolejkę tłumaczeń z
  `docs/AI_MULTILINGUAL_PLAN.md` **tylko gdy `job_sources.allow_translation`**
  (pisemna zgoda VDAB). Bez zgody pokazujemy oryginał, a interfejs (etykiety,
  filtry, enumy) jest przetłumaczony przez i18n jak zwykle.
- Tłumaczenie oznaczone „tłumaczenie automatyczne” + link do oryginału.
  Nie tłumaczymy nazw firm, kontaktów, kwot ani kodów Competent (etykiety
  kodów z mapowania Competent→ESCO).
- Wynagrodzenie: `minimumBrutoLoon`/`maximumBrutoLoon` przez istniejące
  `normalizeSalary`; okres stawki tylko jeśli źródło go podaje — bez zgadywania.

### Prezentacja i prywatność

- Karta i szczegół: „Źródło: VDAB” z linkiem do oferty na vdab.be; bez logo
  VDAB; bez odznaki „Zweryfikowana firma”; CTA aplikowania = link zewnętrzny.
- Dane osoby kontaktowej: nie importujemy, dopóki VDAB nie potwierdzi, że wolno
  (minimalizacja RODO). Payload staging bez tych pól albo z krótką retencją.
- `JobPosting` i sitemap dla ofert VDAB tylko przy `allow_jobposting`; w
  przeciwnym razie `noindex` szczegółu.
- Matching: oferty VDAB mogą wejść do `scoreMatch` przez mapowanie kodów
  Competent → nasze zawody/umiejętności; bez mapowania — tylko lokalizacja,
  umowa i języki.
- Zgłoszenia/takedown: zgłoszenie oferty zewnętrznej ukrywa ją ręcznie przez
  admina z audytem; żądanie pracodawcy przekazujemy do VDAB.

### Testy

Kontrakt parsera na przykładach z publicznej specyfikacji (nieznane pola
ignorowane); idempotencja upsertu (ta sama `versie` = brak zmian); okno bulk >
5 dni odrzucone; `NIET_GEPUBLICEERD` ukrywa ofertę; `apply_to_job` na ofercie
zewnętrznej odmawia; RLS: klient nie pisze pól źródła; brak tłumaczeń przy
`allow_translation=false`; kontrola ujemna dla każdego strażnika.

## Źródła (dostęp 24.09.2026)

- [vac] VDAB, Vacatures afnemen met de Vacature API —
  https://extranet.vdab.be/api-center-excellence-coe/vacatures-ophalen-met-de-vacatures-api
- [coe] VDAB, API Center of Excellence —
  https://extranet.vdab.be/api-center-excellence-coe
- [onb] VDAB, Hoe verloopt de voorbereiding (onboarding) —
  https://extranet.vdab.be/api-center-excellence-coe/hoe-verloopt-de-voorbereiding-onboarding
- [pdf-access] VDAB, Handleiding „Toegang tot VDAB-api's” (juni 2026) —
  https://extranet.vdab.be/system/files/media/bestanden/2026-06/20260604%20Toegang%20tot%20VDAB%20API%27s.pdf
- [pdf-vps] VDAB, Samenwerkingsovereenkomst Vacature Posting API (mei 2025) —
  https://extranet.vdab.be/system/files/media/bestanden/2025-05/inkijkexemplaar%20samenwerkinsgovereenkomst%20VPS.pdf
- [news] VDAB, Nieuws 23-9-2026: onboardingsproces voor developer portal —
  https://extranet.vdab.be/api-center-excellence-coe/nieuws-23-9-2026-onboardingsproces-voor
- [chg] VDAB, Wijzigingsbeleid voor API's —
  https://extranet.vdab.be/api-center-excellence-coe/vdab-wijzigingsbeleid-voor-apis
- [dx] VDAB Werkgevers, Data-uitwisseling met VDAB —
  https://werkgevers.vdab.be/data-uitwisseling
- [form] VDAB, Aanvraagformulier data-uitwisseling —
  https://extranet.vdab.be/aanvraagformulier-data-uitwisseling-met-vdab
- [dev] VDAB Developer Portal, produkt Vacature 4.2.1 (limit 2000/min) —
  https://developer.vdab.be/openservices/product/6209
- [spec] VDAB, specyfikacja OpenAPI Vacatures 4.2.0 (zip) —
  https://developer.vdab.be/openservices/product/6209/download-specs
- [vps] VDAB, Vacatures publiceren met de Vacature Posting API —
  https://extranet.vdab.be/api-center-excellence-coe/vacatures-plaatsen-met-de-vacature-posting-api
- [comp] VDAB, Competent 2 API —
  https://extranet.vdab.be/api-center-excellence-coe/competent-data-ophalen-met-competent-api
- [competent] VDAB, Beroepen- en competentiedatabank Competent —
  https://extranet.vdab.be/competent
- [c20] VDAB, Overschakeling naar Competent 2.0-standaard —
  https://extranet.vdab.be/api-center-excellence-coe/overschakeling-naar-competent-20-standaard-voor-publiceren-van-vacatures
- [verspr] VDAB Werkgevers, Optimale verspreiding van je vacature —
  https://werkgevers.vdab.be/werkgevers/vacature-verspreiden
- [disc] VDAB, Disclaimer (intellectuele eigendom, logo) —
  https://www.vdab.be/disclaimer
- [forem-od] Le Forem, Open data offres d'emploi —
  https://www.leforem.be/open-data.html
- [odwb] ODWB, Offres d'emploi Forem (informacje) —
  https://www.odwb.be/explore/dataset/offres-d-emploi-forem/information/
- [odwb-api] ODWB, metadane zbioru (licencja, pola) —
  https://www.odwb.be/api/explore/v2.1/catalog/datasets/offres-d-emploi-forem
- [forem-api] Le Forem, APIs Forem — https://www.leforem.be/partenaires/api.html
- [actiris] Actiris, Partenaires — https://www.actiris.brussels/fr/partenaires/
