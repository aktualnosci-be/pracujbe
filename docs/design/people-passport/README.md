# Zatwierdzony styl „Ludzie i praca / Paszport pracy”

Decyzja właściciela z rozmowy projektowej 21 września 2026: biel, czerwień #D92932, czerń #151515; logo z białym .be na czerwonym kafelku; karty paszportowe z opcjonalnym polem wynagrodzenia. Ten kierunek zastępuje historyczne granatowe makiety w zakresie wyglądu. Funkcje, bezpieczeństwo i i18n aplikacji pozostają obowiązujące.

## Paczka
`prototype/index.html` — komplet interaktywnej makiety i historycznych kierunków porównawczych. Zatwierdzony kierunek: `#people/home`. `prototype/materials/` — newsletter HTML, banery i social media SVG, instrukcja przygotowania do emisji. `prototype/assets/` — fotografie; autorzy i licencje w `prototype/photo-sources.html`.

Uruchom dowolny serwer statyczny w katalogu prototype. Dane w prototypie są demonstracyjne. Nie przenosić skryptów mockujących procesy do aplikacji produkcyjnej.

## Etapy
1. Fundament: tokeny, logo, przyciski, dokumentacja.
2. Karty paszportowe i szczegóły ofert: rzeczywiste dane, stawki częściowe i brak stawki, cztery języki.
3. Strony publiczne: fotograficzny home, nawigacja, filtry, mobile.
4. Panele i kreatory: kandydat, pracodawca, formularze, stany interfejsu.
5. Komunikacja: React Email, newsletter, materiały reklamowe; nie zmieniać języka odbiorcy ani kolejki wysyłek.
6. Kontrola: dostępność, E2E, regresje, responsywność, zasoby marki i wdrożenie.

## Status
Paczka dostarczona. Wdrożenie aplikacji etapowe; prototyp nie jest dowodem ukończenia funkcji.

## Issues wdrożeniowe
- #2 — fundament identyfikacji
- #3 — paszport ofert i szczegóły
- #4 — strony publiczne i wyszukiwanie
- #5 — panele i kreatory
- #6 — e-mail i materiały reklamowe
- #7 — weryfikacja i wdrożenie

Pierwsza zmiana aplikacji: tokeny kolorów, logo, jasna stopka i sidebar, wysokość głównego przycisku oraz kolor manifestu. Typografia pozostaje lokalnym Inter do osobnego sprawdzenia fontu DM Sans. Ikony PWA/OG i pełny przegląd widoków pozostają w etapie #7.

Manifest PWA jest podłączany osobno dla każdego aktywnego języka (`/{locale}/manifest.webmanifest`). Instalacja z PL/NL/FR/EN otwiera właściwy adres i opis; logo, ikony oraz barwy są wspólne. Dotychczasowy `/manifest.webmanifest` zostaje dla wcześniejszych polskich instalacji. Dodanie języka do routingu wymaga tłumaczeń `common.appName` i `metadata.homeDescription`, ale nie kopiowania generatora manifestu.

Etap #3 zakończony: karty ofert i szczegóły działają w układzie paszportu, z opcjonalnym wynagrodzeniem i etykietami w czterech językach. Okres stawki jest przekazywany przez publiczny model listy i wspólnie formatowany na karcie, detalu oraz w podobnych ofertach. Zapis ofert jest podłączany w #9 i wymaga końcowej weryfikacji na sesji kandydata.

Zapis publiczny: wspólny odczyt pod sesją/RLS dla kolekcji, przyciski detalu synchronizowane w jednym stanie, anonimowy użytkownik kierowany do logowania, tryb demonstracyjny nie udaje trwałego zapisu. Testy przeglądarkowe demo nie dowodzą trwałości na prawdziwej bazie.

Kontynuacja: fotograficzny nagłówek strony głównej używa lokalnego WebP (90 KB) z zatwierdzonego projektu. Sprawdzono w przeglądarce układ desktop i ładowanie zdjęcia oraz brak overflow na 320 px w czterech językach. Publiczny home, lista ofert i filtry mają także zweryfikowany reflow przy 200% (efektywne 640 px) w PL/NL/FR/EN. Szczegóły oraz podobne oferty korzystają z tego samego formattera stawek co paszport: bez zaokrąglania groszy, z od/do i bez deklarowania negocjacji przy braku kwoty (#22).

Doprecyzowanie hero (#166): trzyczęściowy nagłówek i krótki opis z prototypu są dostępne w PL/NL/FR/EN. Przyciski prowadzą do publicznej listy ofert oraz rejestracji kandydata; fotografia ma podpis i jawne oznaczenie jako ilustracyjna. Wyszukiwarka pozostaje bez zmian. Przeglądarkowe testy sprawdzają układ przy 320 i 1440 px, nawigację klawiaturą i reflow przy rzeczywistym powiększeniu 200%.

Etap #4, wraz z dokładnymi licznikami filtrów, jest scalony w `main` w commicie `440409e`: jeden agregat bazy liczy pełny zbiór ofert, a interfejs obsługuje ładowanie, błąd, ponowienie i wyścigi żądań bez pokazywania starej liczby jako aktualnej. Wdrożenie produkcyjne przechodzi przez zielone CI i Railway, a jego poprawność jest weryfikowana osobno.

Etap #5: wspólny wskaźnik kroków kreatora profilu kandydata i oferty pokazuje wyraźnie bieżący etap oraz postęp, zachowując pełną kolejność kroków dla czytników ekranu. Formularze zachowują dotychczasowe pola, walidację i zapis. Układ pasków akcji i treści kreatorów sprawdzono przy 320 px oraz efektywnej szerokości 640 px (powiększenie 200%) w PL/NL/FR/EN. Pozostałe ekrany paneli nadal wymagają przeglądu w ramach #5.

Widok profilu kandydata ma teraz sekcję „Paszport pracy”: zawody, lokalizację i zasięg dojazdu, doświadczenie, dostępność, umiejętności, języki i certyfikaty. Dane są odczytywane pod sesją właściciela; brak wartości ma jawny pusty stan, a błąd odczytu osobny komunikat. Tryb demonstracyjny pokazuje pusty paszport i 0% kompletności, bez fikcyjnej osoby. Edycja nadal prowadzi do kreatora, a załączniki zachowują istniejące akcje. Weryfikacja obejmuje PL/NL/FR/EN i szerokości 320 oraz 640 px. Pozostałe widoki panelu nadal należą do #5.

Lista aplikacji pracodawcy korzysta z kart paszportowych i stronicowania po 12 zgłoszeń. Stan błędu odczytu różni się od pustej listy; zmiana statusu nadal przechodzi przez istniejącą akcję i reguły RPC. Dane demonstracyjne są wyraźnie oznaczone jako niezapisywane. Widok sprawdzono przy 320/640 px w PL/NL/FR/EN. Test demo nie potwierdza zapisu na produkcyjnej bazie.

Lista ofert pracodawcy otrzymała karty paszportowe z rzeczywistymi danymi aktywnej firmy (tytuł, miasto, status, liczba nowych aplikacji i dopasowań). Akcje szkicu i cyklu życia oferty pozostały aktywne. Błąd odczytu jest osobnym stanem z ponowieniem, nie pustą listą. Limit 12 rekordów w źródle danych pozostaje do osobnego zadania z paginacją; obecny ekran nie powinien być opisywany jako pełne archiwum ofert firmy.

Podgląd ofert na pulpicie pracodawcy używa teraz jednego responsywnego układu kart paszportowych zamiast dwóch osobnych widoków tabeli i wierszy mobilnych. Pokazuje pola dostępne z `getCompanyJobsLoad()`; pełne zarządzanie nadal jest na liście ofert. Karty sprawdzono w PL/NL/FR/EN przy 320 px i rzeczywistym zoomie 200%. Podgląd ma ten sam zakres odczytu co wcześniej i nie jest pełnym archiwum ofert.

Odczyt ofert na pulpicie używa jawnego wyniku `getCompanyJobsLoad()`: awaria pokazuje lokalizowany komunikat z ponowieniem, a pusty stan pojawia się wyłącznie po udanym odczycie bez ofert. Karty i odnośnik do pełnej listy pozostają dostępne po udanym odczycie. Test regresyjny obejmuje oba stany w PL/NL/FR/EN.

Ekran firmy pracodawcy zachowuje formularz tworzenia i edycji oraz baner statusu nadawanego wyłącznie przez administratora. Odczyt aktywnej firmy odbywa się pod sesją i RLS; awaria odczytu pokazuje osobny komunikat z ponowieniem, a formularz tworzenia pojawia się tylko przy potwierdzonym braku aktywnego członkostwa. Edycja nazwy i VAT jest dostępna tylko właścicielowi lub administratorowi firmy, zgodnie z polityką RLS; samo zgłoszenie zmiany nie jest sukcesem, dopóki baza nie zwróci zaktualizowanego wiersza. Układ i akcje sprawdzono w PL/NL/FR/EN przy 320 i 640 px; testy jednostkowe sprawdzają również stan błędu.

Lista polecanych ofert kandydata pokazuje uproszczone karty paszportowe oparte na rzeczywistych polach dostępnych w tym odczycie: firma, tytuł, lokalizacja i wynik dopasowania. Gdy dopasowań brak, wynik pochodzi z najnowszych ofert i nie otrzymuje fikcyjnego procentu. Awaria odczytu ma odrębny komunikat oraz ponowienie; zapisywanie oferty i przejście do szczegółów pozostają aktywne. Weryfikacja obejmuje cztery języki i 320/640 px. Pozostałe panele i końcowa matryca nadal należą do #5/#7.

Zasób `public/og.png` jest używany także przez sześć dalszych typów publicznych stron: szczegóły oferty, hub pracy, landing kategorii, landing miasta, listę poradników i poradnik. Każda strona zachowuje własny tytuł, opis oraz adres kanoniczny w metadanych udostępniania. Test HTML sprawdza wszystkie typy w PL/NL/FR/EN; odbiór bezwzględnych adresów HTTPS na produkcji pozostaje częścią etapu #7.

Kompletność profilu na pulpicie i stronie profilu odróżnia pusty profil (0%) od błędu odczytu danych lub liczników relacji. Przy awarii pokazuje komunikat z ponowieniem zamiast fałszywej checklisty; pozostałe liczniki pulpitu nie są zerowane przez sam błąd profilu. To część #5 i naprawa #150, nie kończy przeglądu paneli.

Wiadomości: odczyt pojedynczego wątku rozróżnia gotową rozmowę, brak dostępu lub nieistnienie oraz awarię. Dwa ostatnie przypadki nie ujawniają treści; awaria pokazuje przycisk ponowienia, który odświeża bieżącą trasę z parametrem rozmowy. Dopiero po udanym odczycie oznaczamy wątek jako przeczytany, a licznik w liście zerujemy wyłącznie po sukcesie tej akcji. Ten sam widok obsługuje panel kandydata i pracodawcy w PL/NL/FR/EN. Odczyt nadal korzysta z sesji użytkownika i RLS, a błędy bazy trafiają tylko do diagnostyki. Cofnięcie tej zmiany wymaga przywrócenia dawnego kontraktu odczytu i widoku jednocześnie; samo usunięcie komunikatu ponowienia ponownie ukryłoby awarię jako brak rozmowy.

Wiadomości kandydata i pracodawcy mają wspólny, zlokalizowany stan ładowania podczas przejścia do ekranu oraz komunikat przy klikniętej rozmowie, gdy zmienia się samo `?c=`. Neutralny szkielet nie zawiera fikcyjnych rozmów, a czytnik ekranu otrzymuje komunikat o oczekiwaniu. Istniejące stany pusty i błędu odczytu pozostają osobne. Sprawdzono oba przejścia z opóźnioną odpowiedzią w PL/NL/FR/EN przy 320 i 640 px; to nadal nie potwierdza czasu odpowiedzi produkcyjnej bazy.
