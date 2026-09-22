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

Etap #3 zakończony: karty ofert i szczegóły działają w układzie paszportu, z opcjonalnym wynagrodzeniem i etykietami w czterech językach. Okres stawki jest przekazywany przez publiczny model listy i wspólnie formatowany na karcie, detalu oraz w podobnych ofertach. Zapis ofert jest podłączany w #9 i wymaga końcowej weryfikacji na sesji kandydata.

Zapis publiczny: wspólny odczyt pod sesją/RLS dla kolekcji, przyciski detalu synchronizowane w jednym stanie, anonimowy użytkownik kierowany do logowania, tryb demonstracyjny nie udaje trwałego zapisu. Testy przeglądarkowe demo nie dowodzą trwałości na prawdziwej bazie.

Kontynuacja: fotograficzny nagłówek strony głównej używa lokalnego WebP (90 KB) z zatwierdzonego projektu. Sprawdzono w przeglądarce układ desktop i ładowanie zdjęcia oraz brak overflow na 320 px w czterech językach. Publiczny home, lista ofert i filtry mają także zweryfikowany reflow przy 200% (efektywne 640 px) w PL/NL/FR/EN. Szczegóły oraz podobne oferty korzystają z tego samego formattera stawek co paszport: bez zaokrąglania groszy, z od/do i bez deklarowania negocjacji przy braku kwoty (#22).

Dokładne liczniki filtrów są gotowe na gałęzi `codex/job-filter-exact-counts`: jeden agregat bazy liczy pełny zbiór ofert, a interfejs obsługuje ładowanie, błąd, ponowienie i wyścigi żądań bez pokazywania starej liczby jako aktualnej. Ten zapis opisuje stan przygotowanej zmiany; nie oznacza jej scalenia ani wdrożenia. Końcowe wdrożenie nadal należy do etapu #7 i wymaga zielonych kontroli oraz raportu różnic na połączonym kodzie.
