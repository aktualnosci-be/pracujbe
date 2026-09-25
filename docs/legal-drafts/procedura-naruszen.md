# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Szkic roboczy do issue #490. Nie jest opinią prawną, polityką ani treścią publikowaną
> w serwisie. Pola oznaczone `[DO UZUPEŁNIENIA]` wypełnia właściciel po ustaleniach
> z osobą odpowiedzialną za ochronę danych. Procedurę zatwierdza ta osoba — do tego czasu
> obowiązuje jako materiał do przećwiczenia (tabletop), nie jako zatwierdzona procedura.

## 1. Cel i zakres

Procedura opisuje, jak w Pracuj.be rozpoznajemy, oceniamy, dokumentujemy i komunikujemy
naruszenie ochrony danych osobowych (RODO art. 4 pkt 12, art. 33–34). Obejmuje dane kont,
profili kandydatów, aplikacji, wiadomości i plików CV.

- **Incydent bezpieczeństwa** — zdarzenie dotyczące systemu (np. awaria, próba ataku), które
  nie musi dotyczyć danych osobowych. Rejestrujemy go w rejestrze jako „incydent
  bezpieczeństwa”.
- **Naruszenie ochrony danych osobowych** — naruszenie bezpieczeństwa prowadzące do
  przypadkowego lub niezgodnego z prawem zniszczenia, utracenia, zmodyfikowania,
  nieuprawnionego ujawnienia lub nieuprawnionego dostępu do danych osobowych. Każde takie
  naruszenie rejestrujemy — także wtedy, gdy nie zgłaszamy go do organu.

Monitoring infrastruktury (alarmy, kopie) opisuje osobno `docs/railway/OPERATIONS.md` (#47).

## 2. Role

| Rola | Osoba | Zastępca | Kontakt poza godzinami pracy |
|---|---|---|---|
| Właściciel dyżuru (przyjmuje alarm, otwiera wpis) | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] |
| Osoba odpowiedzialna za ochronę danych (ocena, decyzje art. 33/34) | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] |
| Osoba techniczna (izolacja, dowody, naprawa) | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] |
| Osoba z dostępem do portalu organu nadzorczego | [DO UZUPEŁNIENIA] | [DO UZUPEŁNIENIA] | — |

Bezpieczny kanał zgłoszeń wewnętrznych: [DO UZUPEŁNIENIA]. Szczegółów naruszenia nie
opisujemy w publicznym repozytorium, publicznym issue ani zwykłym czacie zespołu.

Rola platformy wobec danych (administrator czy podmiot przetwarzający w imieniu
pracodawcy) dla poszczególnych procesów: [DO UZUPEŁNIENIA — powiązane z #485]. Gdy platforma
działa jako podmiot przetwarzający, zawiadamia administratora (pracodawcę) bez zbędnej
zwłoki zamiast samodzielnego zgłoszenia — tryb i kanał: [DO UZUPEŁNIENIA].

## 3. Przebieg — od alarmu do decyzji

1. **Przyjęcie sygnału.** Źródło: alarm techniczny, zgłoszenie użytkownika, dostawcy,
   pracownika. Właściciel dyżuru potwierdza przyjęcie.
2. **Stwierdzenie i wpis.** Gdy istnieje uzasadnione przekonanie, że doszło do naruszenia
   danych osobowych, właściciel dyżuru zakłada wpis w panelu administratora
   (`/admin/naruszenia`) i wpisuje **czas stwierdzenia**. Od tej chwili panel liczy termin
   72 h — nie od zakończenia analizy.
3. **Izolacja i dowody.** Osoba techniczna ogranicza skutki (np. odcięcie dostępu,
   unieważnienie sesji i tokenów, wyłączenie funkcji) i zabezpiecza dowody (logi, znaczniki
   czasu) w miejscu o ograniczonym dostępie. Kroki wpisuje w polu „Działania”.
4. **Zakres.** Kategorie danych i przybliżona liczba osób. Do rejestru trafia opis rodzaju
   danych i skala — nie kopie danych, treść CV ani sekrety.
5. **Ocena ryzyka** dla praw i wolności osób, z uzasadnieniem (np. według wytycznych EDPB
   9/2022 i 01/2021). Wynik: ryzyko mało prawdopodobne / prawdopodobne / wysokie.
6. **Decyzja art. 33** (organ nadzorczy) z uzasadnieniem. Przy prawdopodobnym ryzyku —
   zgłoszenie bez zbędnej zwłoki, w miarę możliwości w ciągu 72 h od stwierdzenia. Zgłoszenie
   po terminie wymaga podania przyczyn opóźnienia (panel wymaga tego pola). Zgłoszenie
   można uzupełniać etapami.
7. **Decyzja art. 34** (osoby, których dotyczy) z uzasadnieniem. Przy wysokim ryzyku —
   zawiadomienie bez zbędnej zwłoki, chyba że zachodzi wyjątek z art. 34 ust. 3 (panel
   wymaga wtedy opisu wyjątku).
8. **Komunikacja** (sekcje 5 i 6).
9. **Zamknięcie.** Po udokumentowaniu oceny, decyzji i działań. Panel nie pozwala zamknąć
   naruszenia bez oceny i decyzji. Wpis można ponownie otworzyć z podaniem powodu.

## 4. Scenariusze do ćwiczeń (tabletop)

Dla każdego: kto odbiera sygnał, czas stwierdzenia, izolacja, zakres, ocena, decyzje,
komunikacja, wpis w rejestrze. Wyniki ćwiczeń: [DO UZUPEŁNIENIA — data, uczestnicy, wnioski].

- Plik CV dostępny dla osoby nieuprawnionej (błędny link lub uprawnienie).
- Aplikacja kandydata widoczna dla innego pracodawcy.
- E-mail z danymi wysłany do niewłaściwego odbiorcy.
- Nieuprawniony dostęp osoby z obsługi albo dostawcy (w tym dostawcy usług AI).
- Utrata lub niedostępność danych (awaria, odtworzenie z kopii).

## 5. Zgłoszenie do organu nadzorczego

- Organ właściwy: [DO UZUPEŁNIENIA — np. belgijski organ ochrony danych; do potwierdzenia
  przy przetwarzaniu transgranicznym].
- Kanał zgłoszenia: portal organu — [DO UZUPEŁNIENIA: adres portalu]. Według informacji
  organu zgłoszenia e-mailem nie są przyjmowane — do potwierdzenia przed wdrożeniem.
- Dane kontaktowe organu: [DO UZUPEŁNIENIA].
- Język zgłoszenia: [DO UZUPEŁNIENIA].
- Osoby z dostępem do portalu i zastępca: patrz sekcja 2.
- Materiał do zgłoszenia: eksport JSON/CSV wpisu z panelu (wpis, historia zmian, bez adresów
  odbiorców zawiadomień). Numer zgłoszenia nadany przez organ wpisujemy w pole „Numer
  zgłoszenia u organu”.

## 6. Zawiadomienie osób

- Treść wiadomości przygotowuje i zatwierdza osoba odpowiedzialna za ochronę danych.
  Wymagane elementy treści: [DO UZUPEŁNIENIA przez prawnika].
- Wysyłka: sekcja „Zawiadomienie osób” we wpisie. Treść wpisuje się dla każdego języka
  odbiorców; każda osoba dostaje wiadomość w swoim języku. Brak którejkolwiek wersji
  językowej blokuje wysyłkę.
- Wiadomości trafiają do kolejki e-mail — zakolejkowanie nie oznacza doręczenia. Stan
  doręczeń sprawdzamy w `/admin/poczta` i logach dostawcy; adresy z blokadą (odbicie, skarga)
  nie dostają wiadomości i wymagają innego kanału: [DO UZUPEŁNIENIA].
- Datę zawiadomienia wpisujemy ręcznie po sprawdzeniu wysyłki.

## 7. Dostawcy

- Umowy z dostawcami przetwarzającymi dane powinny przewidywać powiadomienie bez zbędnej
  zwłoki o naruszeniu: [DO UZUPEŁNIENIA — lista dostawców i stan umów].
- Kanał, na który dostawcy wysyłają powiadomienia, i sposób eskalacji poza godzinami pracy:
  [DO UZUPEŁNIENIA]. Test odbioru i eskalacji: [DO UZUPEŁNIENIA — data, wynik].

## 8. Checklista wpisu

- [ ] Czas stwierdzenia wpisany (termin 72 h liczony od niego).
- [ ] Rodzaj: incydent bezpieczeństwa czy naruszenie danych osobowych.
- [ ] Opis stanu faktycznego bez kopii danych i sekretów.
- [ ] Kategorie danych i liczba osób (lub „szacunkowa”).
- [ ] Ocena ryzyka z uzasadnieniem.
- [ ] Decyzja art. 33 z uzasadnieniem; data i numer zgłoszenia albo powód braku zgłoszenia.
- [ ] Przyczyny opóźnienia, jeśli zgłoszenie po 72 h.
- [ ] Decyzja art. 34 z uzasadnieniem; data zawiadomienia albo opis wyjątku.
- [ ] Działania: izolacja, naprawa, zapobieganie.
- [ ] Podsumowanie zamknięcia.

## 9. Dostęp do rejestru

Rejestr jest dostępny wyłącznie dla roli administratora w panelu. Historia zmian jest
niezmienna, a każda zmiana, eksport i zawiadomienie trafia do dziennika zdarzeń
(`/admin/dziennik`). Okres przechowywania wpisów: [DO UZUPEŁNIENIA].

## Źródła

- RODO art. 4 pkt 12, 28 ust. 3 lit. f, 33–34:
  https://eur-lex.europa.eu/legal-content/PL/TXT/?uri=CELEX:32016R0679
- Belgijski organ ochrony danych — naruszenia danych osobowych:
  https://www.autoriteprotectiondonnees.be/professionnel/actions/violation-de-donnees-personnelles
- EDPB, wytyczne 9/2022:
  https://www.edpb.europa.eu/documents/guideline/guidelines-92022-on-personal-data-breach-notification-under-gdpr_en
- EDPB, wytyczne 01/2021 (przykłady):
  https://www.edpb.europa.eu/public-consultations/guidelines-012021-on-examples-regarding-data-breach-notification_en
