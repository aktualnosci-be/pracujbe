# PROJEKT — do weryfikacji prawnika, nieopublikowany

> **Status:** szkic roboczy do issue #492. Nie jest opinią prawną, nie rozstrzyga żadnej
> kwestii i nie może trafić do regulaminu, polityki prywatności ani interfejsu bez przeglądu
> prawnika i decyzji właściciela produktu. Wszystkie stwierdzenia o przepisach poniżej są
> **pytaniami do sprawdzenia**, a nie ustaleniami. Źródła wymienione w issue służą tylko jako
> punkt wyjścia do weryfikacji.

## 1. Cel dokumentu

Właściciel produktu ma wybrać politykę wieku kandydatów: portal tylko dla dorosłych albo
portal obsługujący również osoby niepełnoletnie (np. 15–17 lat, praca uczniowska). Ten
dokument zbiera pytania, które prawnik powinien rozstrzygnąć przed tą decyzją, i opisuje,
co już działa technicznie, żeby nie trzeba było tego odtwarzać z kodu.

## 2. Co jest wdrożone technicznie (bez decyzji prawnej)

Migracja `0110_candidate_age_policy.sql` (numer tymczasowy) i zmiany w aplikacji:

- **Próg jako dane.** Tabela `age_policy` (jeden wiersz): `candidate_min_age` w zakresie
  13–18, domyślnie **18** (najbardziej zachowawczy wariant z issue), z flagą
  `confirmed = false` — wartość robocza, niezatwierdzona. Zmiana progu tylko przez
  administratora (`admin_set_candidate_min_age`, wymagane uzasadnienie, wpis w `audit_logs`).
- **Minimalizacja.** Kandydat składa oświadczenie „mam co najmniej N lat”. Nie zbieramy daty
  ani roku urodzenia ani dokumentu tożsamości. Zapisujemy: zadeklarowany próg, źródło
  (rejestracja / ustawienia), język, czas (`candidate_age_attestations`, wpis niezmienny).
  Gość (aplikacja bez konta) — próg i czas przy zgłoszeniu.
- **Egzekwowanie w bazie** (niezależnie od interfejsu):
  - bez ważnej deklaracji nie można założyć konta kandydata, aplikować, przejąć aplikacji
    gościa ani włączyć widoczności profilu dla firm;
  - firma nie może wysłać propozycji osobie bez ważnej deklaracji (neutralny komunikat);
  - podniesienie progu natychmiast ukrywa profile osób z niższą deklaracją i wymaga nowej
    deklaracji przed kolejną aplikacją. Obniżenie progu niczego nie odsłania.
- **Czego nie ma** (celowo, bo wymaga decyzji): zgody opiekuna, oznaczania ofert dla
  młodocianych, odrębnych zasad kontaktu i AI dla osób niepełnoletnich, procedury dla
  przypadkowo wykrytego konta osoby niepełnoletniej, treści regulaminu i polityki prywatności.

Interfejs pokazuje wyłącznie neutralne komunikaty („Oświadczam, że mam co najmniej {age} lat”,
„Nie pytamy o datę urodzenia ani o dokument tożsamości”). Nie ma tekstów prawnych.

## 3. Pytania do prawnika — decyzja o wariancie

1. Czy portal powinien być kierowany wyłącznie do osób pełnoletnich, czy także do osób
   niepełnoletnich? Jakie są konsekwencje każdego wariantu dla odpowiedzialności operatora?
2. Czy samo oświadczenie „mam co najmniej N lat” jest proporcjonalną kontrolą wieku dla
   wybranego wariantu (RODO art. 5(1)(c), art. 25)? W jakich sytuacjach potrzebna byłaby
   silniejsza weryfikacja i czy jej koszt w danych osobowych byłby uzasadniony?
3. Czy przechowywanie samego oświadczenia (próg + czas) wystarcza do rozliczalności
   (art. 5(2))? Jak długo je przechowywać i co robić przy usunięciu konta (#486)?

## 4. Pytania — podstawy przetwarzania i próg zgody

4. Które operacje w portalu opierają się na zgodzie, a które na innych podstawach z art. 6
   (np. umowa o świadczenie usługi, prawnie uzasadniony interes)? Każdą operację należy
   ocenić osobno: profil, CV, aplikacja, wiadomości, dopasowanie, e-maile, marketing.
5. Czy i kiedy ma zastosowanie art. 8 RODO? Do weryfikacji: czy portal jest „usługą
   społeczeństwa informacyjnego oferowaną bezpośrednio dziecku” oraz czy belgijski próg
   wskazywany w materiałach APD dotyczy wyłącznie przetwarzania opartego na zgodzie.
   Issue zwraca uwagę, że tego progu nie należy mylić z minimalnym wiekiem pracy ani z
   podstawą do publikacji profilu — prośba o potwierdzenie lub korektę tej tezy.
6. Jak traktować użytkowników z innych krajów docelowych (NL, LU, DE, FR, PL), jeśli progi
   z art. 8 różnią się między państwami? Który próg stosować przy kandydacie mieszkającym
   w innym państwie niż Belgia?
7. Jeżeli jakiś proces opiera się na zgodzie, a użytkownik jest poniżej właściwego progu:
   jakiej zgody opiekuna potrzeba i jakie „rozsądne starania” weryfikacji są wymagane?

## 5. Pytania — belgijskie zasady pracy młodocianych

8. Jakie szczególne zasady pracy młodocianych (rodzaje prac, godziny, ograniczenia) trzeba
   uwzględnić, jeśli portal dopuści osoby niepełnoletnie? Źródło do weryfikacji: FPS
   Employment, „jeunes travailleurs”.
9. Jak wygląda zdolność osoby niepełnoletniej do zawarcia umowy o pracę i czy wpływa ona na
   funkcje portalu (propozycja pracy, akceptacja propozycji)? Źródło do weryfikacji: FPS
   Employment, strona o zdolności do zawarcia umowy.
10. Czy oferty dostępne dla osób niepełnoletnich wymagają osobnego oznaczenia, osobnej
    moderacji albo ograniczenia kategorii? Kto odpowiada za zgodność oferty z przepisami:
    pracodawca czy portal?

## 6. Pytania — ochrona profilu, CV, wiadomości i AI (wariant z niepełnoletnimi)

11. Czy profil osoby niepełnoletniej może być widoczny dla firm po samym włączeniu
    widoczności (#494), czy potrzebne są dodatkowe ograniczenia (np. brak wyszukiwania,
    kontakt tylko po aplikacji kandydata)?
12. Czy CV i dane kontaktowe osoby niepełnoletniej mogą trafiać do pracodawcy w tym samym
    trybie co u dorosłych? Issue wskazuje, by nie udostępniać ich automatycznie po samym
    założeniu konta — prośba o określenie warunków.
13. Czy dopasowanie (matching) i funkcje AI są wobec osób niepełnoletnich proporcjonalne?
    Powiązanie z klasyfikacją AI (#489).
14. Czy wiadomości marketingowe mogą być kierowane do osób niepełnoletnich? Jeśli tak, na
    jakiej podstawie i z jakimi ograniczeniami?
15. Jak przygotować informacje zrozumiałe dla młodszych osób (art. 12(1), motyw 38)?

## 7. Pytania — obsługa przypadkowo wykrytego konta

16. Co robić, gdy portal dowie się, że konto należy do osoby poniżej progu (np. zgłoszenie,
    informacja od pracodawcy)? Zablokować, usunąć, ukryć profil, powiadomić — w jakiej
    kolejności i w jakim terminie? Jakie dane zachować jako dowód?
17. Czy pracodawca, który otrzymał aplikację takiej osoby, ma dostać informację, a jeśli
    tak — jaką, żeby nie ujawniać wieku ponad potrzebę?

## 8. Powiązania

- Rejestr czynności przetwarzania — #485.
- Polityka prywatności i strony prawne — #61.
- Cykl życia danych i usuwanie — #486.
- Klasyfikacja AI — #489.
- Widoczność profilu dla firm — #494 (wdrożone, migracja 0100).
- Zgody przy rejestracji — #493 (osobny komponent formularza; deklaracja wieku jest
  w `AgeDeclarationField`, niezależnie od pola zgód).

## 9. Kroki po decyzji właściciela (technicznie)

- Wariant 18+: zatwierdzić próg `admin_set_candidate_min_age(18, true, '<uzasadnienie>')`,
  dodać treść regulaminu/polityki (#61) i komunikat przy rejestracji zatwierdzony przez
  prawnika.
- Wariant z niepełnoletnimi: ustawić próg, a przed uruchomieniem zaprojektować osobno
  (osobne issues): zgodę opiekuna (jeśli wymagana), oznaczenie i moderację ofert, ograniczenia
  widoczności, kontaktu, CV, matchingu, AI i marketingu, procedurę z pkt 16–17. Sam próg
  poniżej 18 bez tych elementów nie powinien być włączany.
