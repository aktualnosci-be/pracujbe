# Zakres projektu wizualnego Pracuj.be

## Źródło przeglądu
Repozytorium aktualnosci-be/pracujbe, lokalna kopia referencyjna. Odczyt README, CLAUDE.md, docs/DESIGN_SCREENS.md, tras aplikacji i schematów src/lib/validation/{candidate,job,application}. Fetch wykonany; HEAD i origin/HEAD: 71ec271f9da83095dfe7af34e94022c6b524f1af. Domyślna śledzona gałąź to origin/claude/ci-selfhosted-setup-953u9x, nie main.

Przegląd dotyczy kodu i dokumentacji, nie działania produkcyjnej bazy. Nowe decyzje właściciela o bieli, czerwieni i czerni zastępują historyczną granatową paletę w projekcie wizualnym. Oryginalna aplikacja nie została zmodyfikowana.

## Rozbudowane w prototypie
- Szczegóły oferty: zadania, wymagania, warunki i jawna informacja o braku stawki.
- Profil zawodowy: zawód, doświadczenie, umiejętności, języki, certyfikaty, dostępność i promień dojazdu.
- Aplikowanie profilem i potwierdzenie przez wpis na liście zgłoszeń.
- Lista aplikacji z prezentacją etapów.
- Propozycje od firm z demonstracyjną odpowiedzią.
- Wiadomości z lokalnym dodaniem odpowiedzi.
- Zapisane oferty i stan pusty.
- Skrócony formularz oferty, który tworzy kartę w bieżącej sesji, ze stawką lub bez.
- Przegląd kandydatów i informacje o firmie, w tym stan oczekiwania na weryfikację.
- Działająca nawigacja boczna paneli i responsywne formularze.

Wszystkie dane są demonstracyjne, zapisy znikają po odświeżeniu. Nie wysyłamy aplikacji, wiadomości ani propozycji. Skrócony formularz oferty nie zastępuje istniejącej walidacji i pełnego kreatora aplikacji.

## Następne ekrany do opracowania na podstawie repo
1. Pełny onboarding kandydata w 6 krokach: dane, zawody, umiejętności, mobilność, języki i certyfikaty, preferencje i zgody.
2. Pełny kreator oferty w 9 krokach: podstawy, umowa i grafik, lokalizacja, wynagrodzenie, obowiązki, wymagania konieczne, wymagania dodatkowe, benefity, firma i publikacja.
3. Filtry ofert: typ umowy, język, transport, zakwaterowanie, wynagrodzenie i okres; sortowanie i paginacja.
4. Logowanie, dwie ścieżki rejestracji, potwierdzenie i reset hasła.
5. Ustawienia kandydata i firmy, prywatność, powiadomienia, obsługa błędów i potwierdzenia działań.
6. Panel firmy: zarządzanie statusami ofert, aplikacje, pełna rozmowa, wysłanie propozycji i weryfikacja firmy.
7. Płatności, pakiety i statystyki — projektować według faktycznego stanu implementacji, bez wymyślania cen.
8. Poradniki, pomoc, FAQ, kontakt, strony prawne i centrum zgód cookies.
9. Warianty PL/NL/FR/EN, w tym długie etykiety i poprawne formatowanie stawek.
10. Widoki administracji oraz stany pusty/błąd/ładowanie/brak dostępu/offline.

## Weryfikacja tej iteracji
- Składnia extended.js sprawdzona przez node --check.
- Ogląd profilu w przeglądarce i zapis profilu potwierdzony komunikatem.
- Utworzenie demonstracyjnej oferty bez stawki, poprawny szczegół oferty i przejście do aplikowania.
- Demonstracyjne zgłoszenie pojawiło się na liście aplikacji.
- Hosting pozostaje zablokowany przez brak dostępu nowego konta; wynik dostępny lokalnie.
