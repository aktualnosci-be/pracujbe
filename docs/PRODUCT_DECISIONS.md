# Decyzje produktowe

## 2026-09-22: bezpłatny etap rozwoju

Pracuj.be rozwijamy obecnie bez monetyzacji. Portal nie sprzedaje pakietów, subskrypcji ani
pojedynczych publikacji ofert. Interfejs nie pokazuje cennika ani zachęt do zakupu, a serwer
odrzuca próby rozpoczęcia checkoutu i zdarzenia sprzedażowego webhooka nawet wtedy, gdy w
środowisku pozostały sekrety Stripe.

Technicznie stan wyłączony wyznacza jedna jawna flaga `BILLING_ENABLED` (domyślnie wyłączona,
`src/lib/billing/flag.ts`). Bez niej klient Stripe jest nieosiągalny, a webhook odpowiada 404.
Samo jej ustawienie nie przywraca sprzedaży — ta wersja nie zawiera przepływu checkoutu.

Tabele finansowe pozostają w bazie, aby wycofanie sprzedaży nie wymagało destrukcyjnej migracji.
Ich obecność nie oznacza, że funkcja jest aktywna. Powrót do monetyzacji wymaga nowej, jawnej
decyzji właściciela oraz osobnego wdrożenia i testów.

Docelowym środowiskiem uruchomieniowym aplikacji i PostgreSQL jest Railway. Migracja techniczna
jest prowadzona osobno; ten wpis opisuje kierunek produktu, a nie potwierdza zakończenia migracji.

## 2026-09-26: pytanie screeningowe odrzucone po publikacji oferty (#497)

Gdy zespół portalu odrzuci pytanie screeningowe oferty, która jest już opublikowana, pytanie
jest ukrywane od razu, a oferta pozostaje aktywna. Kandydaci nie widzą go w formularzu
aplikowania (także bez konta), odpowiedź na nie nie jest przyjmowana i nie powoduje błędu,
a firma nie widzi odpowiedzi udzielonych na to pytanie wcześniej. Te odpowiedzi zostają
w bazie do decyzji o retencji (#486). Aktywni rekruterzy firmy dostają w panelu powiadomienie
z prośbą o poprawkę. Wstrzymanie i wznowienie oferty z ukrytym pytaniem działa; pytanie
w szkicu nadal blokuje publikację do poprawki. Egzekwowanie w bazie: migracja „pytanie
odrzucone po publikacji” (0201 — numer tymczasowy).

## 2026-09-26: porządkowanie bucketu plików w trybie obserwacji

Dzienny przebieg wykrywania osieroconych obiektów w prywatnym buckecie (`STORAGE_GC_MODE`)
zostaje w trybie `dry-run`: liczy sieroty i braki, niczego nie kasuje. Włączenie kasowania
(`delete`) wymaga nowej decyzji po obserwacji liczników w odpowiedzi `/api/maintenance`.

## 2026-09-26: propozycja pracy a dane z konta (#494)

Zachowanie bez zmian: propozycja pracy tworzy relację firma–kandydat
(`company_can_view_candidate` po `offers`), więc aktywni rekruterzy firmy, która wysłała
propozycję, widzą imię i dane kontaktowe kandydata z konta — także gdy kandydat nie włączył
widoczności profilu dla firm. Firma, którą kandydat zablokował (#97), tego dostępu nie ma.
Po stronie kandydata propozycja pokazuje firmę; imienia rekrutera w rozmowach nadal nie
ujawniamy (0023). Decyzja zamyka punkt otwarty w sekcji widoczności profilu (#494).
