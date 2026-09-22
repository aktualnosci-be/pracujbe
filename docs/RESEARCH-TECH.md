# Research techniczny: rejestry firm, kompetencje i wzorce rynku pracy

Stan weryfikacji: 22 września 2026. Dokument oddziela fakty potwierdzone w
źródłach pierwotnych od obserwacji technicznych i hipotez. Nie jest zgodą na
wysłanie wniosku, zawarcie umowy, import danych ani wdrożenie funkcji.

## Legenda

- **Potwierdzone** — wynika z oficjalnej dokumentacji lub z kodu i testów repo.
- **Do potwierdzenia** — obserwacja jest użyteczna, ale nie ma stabilnego,
  oficjalnego kontraktu albo wymaga oceny licencji/prawnej.
- **Hipoteza** — kandydat do discovery i osobnego issue; nie jest elementem MVP,
  dopóki nie zostanie zatwierdzony.

## VIES: weryfikacja numeru firmy

### Potwierdzone

Komisja Europejska udostępnia [system VIES do sprawdzania numerów VAT](https://taxation-customs.ec.europa.eu/online-services/online-services-and-databases-taxation_en).
Usługa może być zewnętrznym sygnałem, ale odpowiedź sieciowa nie jest dowodem
uczciwości firmy ani aktualności konkretnej oferty.

### Do potwierdzenia przed implementacją

Zaobserwowany endpoint REST zwraca pola takie jak `isValid`, `userError`, `name`
i `address`, lecz nie znaleziono stabilnej oficjalnej dokumentacji tego
kontraktu. Nie wolno uzależniać produkcji od nieudokumentowanego kształtu bez
testu kontraktowego, limitu czasu, cache i możliwości wyłączenia integracji.

Wynik rozgałęziamy najpierw według klasy odpowiedzi:

- ważny numer — sygnał pozytywny z datą sprawdzenia;
- jednoznacznie nieważny numer — informacja o wyniku sprawdzenia;
- limit, niedostępność państwa członkowskiego, timeout, błąd formatu odpowiedzi
  lub inny błąd infrastruktury — stan „nie udało się sprawdzić”.

`HTTP 200` ani samo `isValid: false` nie wystarcza do pokazania ostrzeżenia o
nieważnej firmie. Szczególnie kod obserwowany jako `MS_MAX_CONCURRENT_REQ` musi
być traktowany jako błąd przejściowy. Tę obserwację trzeba utrwalić fixture'em i
testem negatywnym, nie przedstawiać jako gwarantowany publiczny kontrakt VIES.

Przed odznaką trzeba również potwierdzić oficjalne zasady normalizacji belgijskiego
VAT/KBO, zakres dopuszczalnego cache, wymagania atrybucji i komunikat dla
użytkownika. Implementacja wymaga nowego issue; discovery podaży prowadzi
[#90](https://github.com/aktualnosci-be/pracujbe/issues/90).

## ESCO: lokalny słownik zawodów i umiejętności

### Potwierdzone

Komisja Europejska podaje, że ESCO opisuje 3 039 zawodów i 13 939 umiejętności
w 28 językach, w tym `pl`, `ro`, `uk`, `fr`, `nl` i `en`. Bieżąca wersja to
v1.2.1, z aktualizacją z 10 grudnia 2025. Dataset można pobrać bezpłatnie w
formatach m.in. CSV i TTL; warunki ponownego użycia wymagają atrybucji oraz
oznaczenia modyfikacji.

Źródła pierwotne:

- [opis ESCO i liczby pojęć](https://esco.ec.europa.eu/uk/node/509),
- [pobieranie datasetu i wersje](https://esco.ec.europa.eu/en/use-esco/download),
- [warunki pobrania i ponownego użycia](https://esco.ec.europa.eu/en/use-esco/download/privacy-statement),
- [informacja o ukraińskich tłumaczeniach](https://esco.ec.europa.eu/uk/node/490).

### Zalecany kontrakt importu

1. Pobieramy ręcznie zatwierdzony snapshot wersji 1.2.1, zapisujemy URL źródła,
   datę pobrania, sumę pliku, języki i tekst atrybucji.
2. Parser działa offline i zapisuje kanoniczne identyfikatory, etykiety,
   synonimy, relacje zawod–umiejętność oraz wersję źródła do PostgreSQL.
3. Import jest idempotentny, ma kontrolę liczebności i referencji oraz dry-run.
4. Aktualizacja wersji jest osobną migracją danych z raportem różnic. Nie
   nadpisuje automatycznie ręcznie zatwierdzonych nazw produktu.
5. Runtime nie wywołuje publicznego API ESCO przy każdym żądaniu.

ESCO jest słownikiem i źródłem relacji, nie modelem decyzyjnym. Nie zmienia
deterministycznego dopasowania i nie rozstrzyga, które wymagania pracodawca
oznaczy jako obowiązkowe. Prace należy powiązać z audytem locale i glosariuszem
[#29](https://github.com/aktualnosci-be/pracujbe/issues/29)–[#30](https://github.com/aktualnosci-be/pracujbe/issues/30),
a dalsze użycie z kolejką i walidacją [#31–#38](https://github.com/aktualnosci-be/pracujbe/issues/38).

## VDAB: Competent 2 a dane o wakatach

### Potwierdzone

[Competent 2 API](https://extranet.vdab.be/api-center-excellence-coe/competent-data-ophalen-met-competent-api)
udostępnia profile zawodów i ich elementy. VDAB opisuje dane jako open data bez
ograniczeń użycia i API jako dostępne dla każdego, ale dostęp przechodzi przez
onboarding do katalogu open data.

Dane o wakatach mają inny reżim. Oficjalny
[opis onboardingu](https://extranet.vdab.be/api-center-excellence-coe/hoe-verloopt-de-voorbereiding-onboarding)
wskazuje, że pobieranie wakatów jest danymi z ograniczeniami i może wymagać
rozmowy oraz umowy. Osobno
[Vacature Posting API](https://extranet.vdab.be/api-center-excellence-coe/vacatures-plaatsen-met-de-vacature-posting-api)
służy do publikowania własnych ofert w VDAB, wymaga umowy i procesu testowego;
nie jest darmowym feedem ofert do republikacji.

### Decyzja na teraz

- można przygotować issue badawcze dla mapowania Competent 2 do ESCO i naszego
  modelu zawodów;
- nie składamy obecnie wniosku, nie podpisujemy umowy i nie projektujemy importu
  wakatów, dopóki właściciel nie wybierze konkretnego przypadku użycia;
- dane od pierwszych firm pozyskujemy w autoryzowanym procesie z #90, niezależnie
  od czasu rozmów z VDAB.

## RLS po odejściu od Supabase

### Potwierdzone w repozytorium

Ryzyko połączenia jako właściciel tabel jest realne dla PostgreSQL, ale obecny
zatwierdzony model już mu przeciwdziała:

- migrator `postgres` pozostaje właścicielem DDL;
- loginy runtime są `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS` i nie są
  właścicielami obiektów;
- pula sprawdza login i rolę startową;
- narzędzie `db:logins` sprawdza dryf ownership, ACL i członkostw;
- kontekst użytkownika jest ustawiany lokalnie w pojedynczej transakcji na
  zarezerwowanym połączeniu.

Prowadzą to [#23](https://github.com/aktualnosci-be/pracujbe/issues/23) i
[#25](https://github.com/aktualnosci-be/pracujbe/issues/25). Ich kryteria wymagają
asercji `session_user`, `current_user`, `row_security=on`, braku obcego odczytu
oraz kontroli ujemnej po celowym nadaniu ownership lub błędnego grantu.

`FORCE ROW LEVEL SECURITY` nie jest wymagane w tym modelu. Nie należy dodawać go
mechanicznie na podstawie ogólnego ostrzeżenia: bezpieczeństwo zapewnia rozdział
właściciela od runtime i test odrzucający dryf. FORCE można ocenić później jako
obronę dodatkową tylko z testami funkcji `SECURITY DEFINER`, migracji i operacji
serwisowych.

## Wzorce funkcji z projektów open source

Poniższe elementy są hipotezami. Licencja repozytorium nie zwalnia z własnego
projektu bezpieczeństwa, prywatności i UX; repozytoria AGPL służą wyłącznie do
lektury, jeśli kod nie ma zostać objęty kompatybilną licencją.

| Priorytet badawczy | Wzorzec | Wartość dla Pracuj.be | Warunek wejścia |
|---|---|---|---|
| 1 | aplikowanie bez konta (`apply_token`/`claim_token`) | krótsza droga na telefonie | threat model tokenu, weryfikacja e-mail, idempotencja i deduplikacja |
| 2 | pytania screeningowe i jawny `knockout` | dane potrzebne w rekrutacji technicznej | kandydat widzi skutek; brak ukrytej automatycznej selekcji |
| 3 | moderacja pojedynczej oferty i kody zgłoszeń | firma zweryfikowana nie gwarantuje treści każdej oferty | kolejka, audit log, odwołanie i testy tenantów |
| 4 | zapisane wyszukiwania i alerty | retencja oparta na aktualnych ofertach | preferencje, wypisanie, locale odbiorcy i limit częstotliwości |
| 5 | dzienny agregat pojawień w wyszukiwaniu | lejek bez klientowego trackera | minimalizacja danych, brak surowych zapytań z PII |
| 6 | kanoniczne wynagrodzenie i jawny stan braku stawki | poprawne filtrowanie różnych okresów płacy | reguły konwersji, waluta, brutto/netto i belgijskie baremy |
| 7 | ważność dokumentów i certyfikatów | wygasły dokument nie daje fałszywego dopasowania | przypomnienia, prywatność i brak samoczynnego odrzucenia |
| 8 | deduplikacja e-mail/telefon | mniej podwójnych profili i aplikacji | E.164, scalanie, odwołanie i przypadki współdzielonych danych |
| 9 | blokowanie firmy | kontrola bezpieczeństwa po stronie kandydata | wpływ na oferty, wiadomości, propozycje i audyt |

Przykładowe źródła do czytania modeli danych:

- [cncf/gitjobs](https://github.com/cncf/gitjobs) — migracje, moderacja i wyszukiwanie;
- [golang-cafe/job-board](https://github.com/golang-cafe/job-board) — aplikowanie bez konta i tokeny edycji;
- [hasgeek/hasjob](https://github.com/hasgeek/hasjob) — zapisane filtry i antyspam; licencję trzeba sprawdzić przed użyciem kodu;
- [Odoo hr_recruitment](https://github.com/odoo/odoo/tree/19.0/addons/hr_recruitment) — model etapów i powodów odmowy;
- [digitalfabrik/integreat-cms](https://github.com/digitalfabrik/integreat-cms) — wielojęzyczna redakcja treści dla osób migrujących.

Każda wybrana funkcja otrzymuje osobne issue. Nie dokładamy jej do #29–#38,
które prowadzą tłumaczenia, ani do #90–#91, które prowadzą discovery i pilotaż.

## Kanały komunikacji

Telegram Bot API jest kandydatem do taniego pilotażu powiadomień. WhatsApp ma
więcej wymagań operacyjnych i zależność od zatwierdzonych szablonów. Ceny,
popularność kanałów i zasady dostawców zmieniają się, więc raportowane kwoty nie
są zapisane tu jako fakty. Wybór kanału następuje w #91 na podstawie rozmów,
zgód, pełnej wersji językowej, aktualnego cennika i mierzalnego eksperymentu.

Nie używamy nieoficjalnych bibliotek obchodzących zasady komunikatora. Bot nie
prowadzi autonomicznej rozmowy i nie wysyła aplikacji za użytkownika.

## Następne decyzje i bramki

1. Dokończyć #23 i #25; zweryfikować dokładne loginy produkcyjne przed każdym
   wdrożeniem backendu.
2. Zrealizować discovery podaży #90 i na jego podstawie zatwierdzić pola oferty.
3. Otworzyć osobne issue dla eksperymentu VIES; najpierw kontrakt błędów i test
   fałszywego `invalid`, potem UI odznaki.
4. Otworzyć osobne issue dla wersjonowanego importu ESCO; połączyć jego glosariusz
   z #29–#30, bez blokowania bezpieczeństwa backendu.
5. Rozbić wybrane wzorce funkcji na małe issues dopiero po rozmowach z #90.
6. Domknąć integralność propozycji #88 i bezpłatny MVP #51.
7. Uruchomić pilotaż kandydatów #91 dopiero po spełnieniu progu aktualnych ofert.

Ten porządek zachowuje Railway-only, bezpłatny MVP, sześć języków i
deterministyczny matching. Research rozszerza backlog; nie zmienia tych decyzji.
