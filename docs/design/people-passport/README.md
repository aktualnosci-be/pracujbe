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

Etap #3 rozpoczęty: karty ofert w układzie paszportu, opcjonalne wynagrodzenie i etykiety w czterech językach. Ograniczenia nadal otwarte: okres stawki nie jest przekazywany przez model listy; prawdziwy zapis ofert na publicznych kartach wymaga #9. Szczegóły ofert pozostają do przebudowy.
