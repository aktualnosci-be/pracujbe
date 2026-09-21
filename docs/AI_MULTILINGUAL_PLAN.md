# AI i sześć języków — research i plan wdrożenia

Stan: 21.09.2026. Decyzja właściciela: pl, ro, uk, fr, nl, en; automatyczne tłumaczenie ofert i profili również po edycji. Dokument jest planem, nie potwierdzeniem wdrożenia ani benchmarkiem jakości. Audyt kodu: 3c48cbc1e777ca35eff4e1bdce0b397b592503a6.

## Co istnieje

Routing src/i18n/routing.ts obsługuje pl/nl/fr/en. Ograniczenia czterech języków są również w SQL (0002–0007,0054), walidacji auth, kolejce maili0061, helperach odbiorcy i publicznych RPC. Dopisanie dwóch plików JSON nie wystarczy. job_translations (0003_jobs.sql) przechowuje tytuł, opis, obowiązki, warunki, benefity, highlights, godziny, zmiany, opis firmy i meta. Nie ma rewizji źródła, stanu tłumaczenia ani wykonawcy AI. job_requirements ma własne locale i również wymaga synchronizacji. candidate_profiles ma headline, bio i occupations; umiejętności, certyfikaty i języki są osobnymi relacjami. Brak lokalizowanych wersji profilu. Istniejący matching jest deterministyczny; nie zastępujemy go niezweryfikowanym rankingiem AI.

## Research dostawców

| Opcja | Ustalone możliwości | Decyzja do sprawdzenia |
|---|---|---|
| DeepL API | Tłumaczenie tekstu, kontekst, glosariusze, wykrywanie języka, metryka billed_characters. Aktualne możliwości konkretnej pary należy odczytać z API languages. | Kandydat na bazowy silnik tłumaczenia, porównać jakość terminów belgijskich i wszystkich30 kierunków. |
| OpenAI API | Structured Outputs ogranicza strukturę odpowiedzi; nie gwarantuje prawdziwości tłumaczenia. Umożliwia tłumaczenie pól z kontekstem oraz oddzielnego asystenta redakcyjnego. | Kandydat na silnik tłumaczenia/asystenta. Wybrać model i wersję na podstawie porównania jakości, ceny i opóźnienia. |
| Google Cloud Translation Advanced | Usługa tłumaczeń oraz glosariusze; alternatywa porównawcza. | Zweryfikować pary, region przetwarzania, umowę i koszt przed produkcją. |

Rekomendacja projektowa: wspólny niewielki interfejs dostawcy i benchmark DeepL/OpenAI; Google jako opcja porównawcza. Nie wybieramy zwycięzcy na podstawie reklamy ani deklaracji modelu. Bez kupowania abonamentów, konfiguracji płatnego API i wysyłania prawdziwych profili w ramach tego researchu.

Źródła (odczyt21.09.2026):
- [DeepL języki i dostępność funkcji](https://developers.deepl.com/docs/getting-started/supported-languages)
- [DeepL translate/context/billed_characters](https://developers.deepl.com/api-reference/translate/request-translation)
- [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)
- [Google tłumaczenie](https://docs.cloud.google.com/translate/docs/translate-text)
- [Google glosariusze](https://docs.cloud.google.com/translate/docs/advanced/glossary)

## Zasady treści

Język źródłowy wybiera autor; detekcja jedynie proponuje wybór i wykrywa tekst mieszany. Locale uk oznacza ukraiński (nie ua). NL/FR uwzględniają terminologię belgijską, bez podmiany wymaganych kwalifikacji. Tłumaczenie bezpośrednio ze źródła na każdy cel; bez łańcucha przez angielski.

Nie tłumaczymy nazw osób/firm, kontaktów, identyfikatorów, kwot, walut, wymiaru czasu, brutto/netto, okresu stawki, poziomów języka ani nazw certyfikatów takich jak VCA/BA4/BA5/SEP. Etykiety enumów są tłumaczone przez i18n. Tekstowe nazwy zawodów/umiejętności mogą mieć lokalizowane etykiety, ale nie zmieniają oryginału i kodu kompetencji. Język interfejsu ani posiadanie tłumaczenia nie oznaczają znajomości języka przez kandydata.

Oferty: wszystkie pola tekstowe job_translations oraz wymagania tekstowe. Profile: headline, bio, zawody i opisowe kompetencje, później potwierdzone opisy doświadczenia. Plik CV nie jest automatycznie wysyłany do AI w tej funkcji. Dane wrażliwe wykryte w swobodnym tekście wymagają minimalizacji przed zleceniem.

## Rewizje i spójność

1. Zapis źródła tworzy niezmienną rewizję i hash kanonicznych pól. W tej samej transakcji PostgreSQL powstają zadania dla pięciu celów. Brak faktycznej zmiany tekstu nie generuje kosztu. Zmiana języka źródła jest nową rewizją.
2. Kolejka DB: stany queued/leased/succeeded/retry/failed/superseded, próby, next_attempt_at, lease_id, termin, koszt i kody błędów. Klucz unikatowy: typ encji+ID+rewizja+cel+wersja pipeline/glosariusza. Worker w Railway, SKIP LOCKED; żadne połączenie HTTP do dostawcy nie trzyma transakcji DB.
3. Częste zapisy robocze są scalane; publikacja/przekazanie profilu przyspiesza ostatnią rewizję. Docelowo p95<120s dla zwykłej aktualizacji przy ustalonym obciążeniu — cel do pomiaru, nie gwarancja dostawcy.
4. Przed zapisem wyniku worker ponownie sprawdza rewizję, aktywność, widoczność i lease. Wynik starej rewizji jest superseded. Przy ukryciu/usunięciu profilu lub oferty zaległy wynik niczego nie publikuje.
5. Aktualizacja tłumaczonego dokumentu jest atomowa w obrębie języka: nie miesza tytułu z v2 i opisu z v1. Cache pola może ograniczyć koszt, ale walidujemy pełny zestaw przed aktywacją.
6. Korekta ręczna ma autora i wersję. AI nie nadpisuje jej po cichu. Zmiana źródła oznacza korektę jako nieaktualną i przygotowuje nową propozycję; zatwierdzenie albo reset blokady są jawne.
7. Po zmianie źródła stara treść nie udaje aktualnego przekładu. Czytelnik widzi aktualny oryginał z oznaczeniem języka i stanem tłumaczenia; historyczny przekład tylko w oznaczonym podglądzie historii. Formularz aplikacji wskazuje wersję, którą kandydat widział, i aktualne warunki strukturalne.

## Ochrona i jakość

Schemat JSON, kompletność pól, długości, lista dozwolonych kluczy, identyczność liczb/jednostek i negacji, brak dodatkowych kwalifikacji. Obowiązkowe/przydatne wymagania nie mogą zmieniać kategorii. Tekst użytkownika traktowany jako dane: brak narzędzi, wykonywania instrukcji, pobierania URL czy uprawnień DB w modelu. Sanitizacja HTML niezależna od dostawcy.

Zestaw odbiorowy: co najmniej300 tekstów syntetycznych lub z prawami do użycia, po10 na każdy z30 kierunków, oferta/profil, krótkie pola, literówki, cyrylica, diakrytyki, tekst mieszany, instrukcje w treści, stawki i warunki. Ocena przez osoby znające oba języki; model recenzent może pomagać, ale nie jest jedynym sędzią. Zero krytycznych zmian stawek, negacji lub kwalifikacji w zestawie odbiorowym. Próg oceny płynności i minimalny poziom zgodności ustalić przed porównaniem dostawców. Samo tłumaczenie wsteczne nie jest dowodem jakości.

Profile zachowują identyczne RLS i ograniczenia kontaktu/udostępnienia jak źródło, również w wyszukiwaniu, cache i mailach. Brak publicznego SEO profili. Pracodawca nie uzyska prywatnego profilu przez endpoint tłumaczeń. Usunięcie konta czyści kopie, zadania i cache, a opóźniony worker nie odtwarza danych.

Przed wysyłką danych osobowych: rejestr celu i podstawy przetwarzania, informacja dla użytkownika, umowa powierzenia, retencja, region i podwykonawcy; ocena potrzeby DPIA z kompetentnym specjalistą. Nie utożsamiać „API nie trenuje na danych” z zerową retencją. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) opisuje m.in. standardową retencję monitoringu nadużyć i warunki ZDR; store:false samodzielnie nie usuwa wszystkich śladów. Konfigurację konkretnego konta trzeba potwierdzić.

## Koszty i eksploatacja

Rezerwacja budżetu przed wywołaniem, twarde limity globalne i per firma/profil, długość pól, debounce, cache tylko w obrębie uprawnionej encji, deduplikacja, maksymalna liczba prób, alarm i wyłącznik bez utraty źródeł. Model kosztowy: suma tokenów wejścia/wyjścia razy stawki modelu lub znaki razy stawka tłumaczeń, pomnożona przez pięć celów i liczbę zmienionych rewizji, plus walidacja/ponowienia/worker. Raport dla100/1000/10000 ofert i profili, wariant1/5edycji. Ceny pobrać w benchmarku z aktualnych cenników — brak pomiaru kosztu w tym dokumencie.

[OpenAI Batch](https://developers.openai.com/api/docs/guides/batch) dokumentuje rabat50% i okno24h: nadaje się do kontrolowanego backfillu lub ewaluacji, nie do zwykłych aktualizacji tuż po zapisie. Zastosowanie do profili wymaga osobnej kontroli retencji plików. Retry429/5xx z jitterem, brak ponawiania trwałych błędów walidacji, idempotentny odbiór spóźnionych wyników; nie obiecywać dokładnie jednokrotnego naliczenia kosztu po timeoutach dostawcy.

Metryki bez treści: pokrycie bieżącej rewizji na język, p95opóźnienia, odrzucone wyniki, kolejka, koszt/encja/rewizja, błędy dostawcy. Sentry/logi bez CV, tekstów, tokenów i danych kontaktowych.

## Pełny produkt w sześciu językach

UI, błędy, rejestracja, zgody, szablony e-mail, legal z przeglądem człowieka, routing, formatowanie i locale odbiorcy. Wyszukiwanie musi znajdować aktualne przetłumaczone treści z uwzględnieniem alfabetu/diakrytyków. Publiczne oferty: lang/hreflang/canonical/sitemap/JobPosting tylko dla rzeczywiście dostępnych aktualnych wersji. Cache unieważniany po zmianie i usunięciu. Tłumaczenia UI są wersjonowanymi plikami poddanymi review, bez wywołań AI przy każdym wejściu.

## Dalszy asystent AI

Po fundamentach: redakcja oferty bez dopisywania warunków, tworzenie profilu z odpowiedzi użytkownika, import CV z zatwierdzeniem każdego wyciągniętego pola, wyjaśnienie oferty prostym językiem, propozycje zapytań wielojęzycznych i tłumaczenie wiadomości na żądanie z widocznym oryginałem. Każda zmiana wymaga akceptacji autora; AI nie wysyła aplikacji ani wiadomości za człowieka bez jawnej akcji.

Automatyczna selekcja, ranking kandydatów i wnioskowanie o cechach osobistych nie są ukrytym rozszerzeniem tłumacza. Wymagają osobnej decyzji i oceny: [Komisja Europejska, AI Act recital57](https://ai-act-service-desk.ec.europa.eu/en/ai-act/recital-57) wskazuje rekrutację i selekcję jako obszar wysokiego ryzyka. Nie oznacza to automatycznej klasyfikacji samego tłumacza; klasyfikacja zależy od zastosowania.

## Kolejność wdrożenia

Najpierw domknięcie PostgreSQL/auth i workerów (#23–#27). Równolegle można wykonać audyt locale, kontrakt danych i syntetyczny benchmark. Potem wersjonowanie+outbox, provider+walidacja, oferty, profile, UI/SEO, odbiór i rollout przez flagę. Produkcja wyłącznie main, bez staging; testy w izolowanych środowiskach. Backfill idempotentny i wznawialny, rollback wyłącza worker/publikację tłumaczeń, zachowuje oryginały oraz ręczne korekty.

