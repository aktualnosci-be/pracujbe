# Dostawca poczty — zakres danych i ocena transferu (szkic roboczy)

> **PROJEKT — do weryfikacji prawnika, nieopublikowany.**
> Wersja robocza 0.1 (2026-09-25), przygotowana do #503. Opisuje to, co **wynika z kodu
> repozytorium**: jakie dane trafiają do dostawcy poczty i jakie zabezpieczenia są w portalu.
> Ocena prawna (art. 28, rozdział V RODO), DPA konta, podprocesorzy, lokalizacja danych,
> mechanizm transferu i retencja u dostawcy **nie wynikają z kodu** i zostają do ustalenia
> przez właściciela i prawnika. Deklaracje dostawcy przytoczone w #503 nie są tu faktami —
> wymagają sprawdzenia dla konta portalu na dzień uruchomienia.
> Poufnych umów nie umieszczamy w publicznym repozytorium — tu tylko odnośnik, data i wynik.

Powiązane: [`dostawcy-i-transfery.md`](dostawcy-i-transfery.md) (sekcja 3),
[`data-map.generated.md`](data-map.generated.md) (sekcja 4 — pola każdego szablonu),
[`rejestr-czynnosci.md`](rejestr-czynnosci.md) (#485), [`retencja-i-prawa-kandydata.md`](retencja-i-prawa-kandydata.md) (#486).

## 1. Co trafia do dostawcy (z kodu)

Worker (`src/lib/email/outbox.ts`) wywołuje `resend.emails.send` z polami: nadawca, adres
odbiorcy, temat, treść HTML, wersja tekstowa, opcjonalnie nagłówki wypisania; klucz
idempotencji = identyfikator wiersza kolejki. Bez `RESEND_API_KEY` nic nie wychodzi.

Treść budują trzy warstwy:

1. **Payload kolejki** (`email_deliveries.payload`) — ustawiają go funkcje SQL. Klucze każdego
   szablonu są generowane z aktualnych migracji (mapa danych, sekcja 4).
2. **Lista pól dozwolonych** (`src/lib/email/payload-fields.ts`) — worker przekazuje do
   szablonu **tylko** te pola. Resztę payloadu odrzuca przed renderem; zostaje ona w bazie
   portalu, nie u dostawcy. Mapa danych pokazuje w kolumnie „Odrzucane przez workera”, które
   pola SQL nie wychodzą.
3. **Dane dokładane przez workera** — imię odbiorcy (z jego profilu), link do sekcji panelu
   w języku odbiorcy, stopka wypisania, tożsamość nadawcy (marketing).

### Minimalizacja — stan po #503

| Rodzaj danych | Czy trafia do treści maila | Zabezpieczenie |
|---|---|---|
| Plik CV, nazwa pliku | nie | brak pola na liście; test kanarkowy |
| Odpowiedzi na pytania screeningowe | nie | jw. |
| Treść wiadomości w rozmowie (także podgląd) | nie — e-mail zawiera nadawcę i link do wątku | `preview` poza listą `newMessage` |
| Wiadomość pracodawcy do propozycji pracy | nie — e-mail zawiera stanowisko, firmę i link do propozycji | `message` poza listą `jobOffer` |
| Telefon, adres e-mail kandydata, NISS/BIS, dane zdrowotne | nie | wzorzec zakazanych nazw pól + test kanarkowy |
| Filtry zapisanego wyszukiwania (`query`) | nie | poza listą `jobMatch` |
| Imię i nazwisko kandydata w e-mailu do firmy (`newApplication`, `offerAccepted`, `offerDeclined`) | **tak** | do decyzji (sekcja 4) |
| Imię i nazwisko kandydata jako nadawcy wiadomości do firmy (`newMessage`) | **tak** | do decyzji (sekcja 4) |
| Nazwa firmy i tytuł oferty | tak | dane oferty publicznej |
| Uzasadnienie decyzji administratora / moderacji, treść zawiadomienia o naruszeniu | tak — to jest treść, którą adresat ma otrzymać | pisze ją administrator portalu |
| Numer sprawy DSA i kod dostępu (`reportReceived`) | tak | kod w części `#` linku, w bazie tylko skrót |

Test: `tests/unit/email-payload-minimization.test.ts` — każdy wysyłany szablon w czterech
językach, render ścieżką workera z wartościami-kanarkami (CV, odpowiedzi, treść rozmowy,
telefon, e-mail kandydata); kontrola ujemna: bez listy te same wartości trafiają do treści.
Nowe pole w payloadzie SQL powoduje czerwony test, dopóki ktoś nie zdecyduje, czy je wysyłać.

## 2. Uprawnienie odbiorcy w chwili wysyłki

E-maile z danymi kandydata do firmy kolejkujemy tylko dla aktywnych rekruterów, administratorów
i właścicieli firmy z aktywnym kontem. Od #503 (migracja `0122`) to samo
sprawdzamy przy odbiorze wiersza z kolejki (`claim_email_batch` → `email_recipient_authorized`):
odebrana rola, dezaktywowane członkostwo, zamknięte konto albo usunięty obiekt (aplikacja,
propozycja, wiadomość) = wiersz nie wychodzi i zostaje jako ślad
(`error_message = 'suppressed_recipient_unauthorized'`). Kandydat jako odbiorca wiadomości —
bez zmian. Dowód: `supabase/tests/rls.sql` sekcja ES503 (z kontrolą ujemną).

Ograniczenie: sprawdzenie następuje przy odbiorze paczki przez workera; wysyłka następuje
chwilę później w tym samym przebiegu. Wiadomości już doręczonej portal nie cofnie.

## 3. Ocena transferu — struktura do wypełnienia

| Krok | Treść | Dowód / data sprawdzenia | Kto |
|---|---|---|---|
| Aktywny tor produkcyjny (dostawca / poczta wyłączona) | do ustalenia (bez ujawniania sekretów) | | właściciel |
| Rola dostawcy (procesor / podprocesor) dla treści i metadanych | do ustalenia | | prawnik |
| DPA przypisane do konta (wersja, data) | do ustalenia | | właściciel |
| Lista podprocesorów (także antyabuse/analityka) na dzień uruchomienia | do ustalenia | | właściciel |
| Lokalizacja przechowywania treści, logów doręczeń i webhooków; region wysyłki | do ustalenia (region wysyłki ≠ lokalizacja magazynu) | | właściciel |
| Mechanizm transferu (art. 45 — status certyfikacji w oficjalnym rejestrze; art. 46 — SCC, moduł) | do ustalenia | | prawnik |
| Ocena ryzyka transferu i środki dodatkowe | do ustalenia | | prawnik |
| Retencja treści i logów u dostawcy, backupy, okres po zamknięciu konta | do ustalenia | | właściciel |
| Śledzenie otwarć i kliknięć na koncie (oczekiwane: wyłączone) | do ustalenia; kod nie włącza śledzenia | | właściciel |
| Informacja o odbiorcach i transferze w informacji o prywatności (PL/NL/FR/EN) | do ustalenia (#40, #61) — bez tekstów w UI z tego szkicu | | prawnik |
| Właściciel przeglądu okresowego i termin | do ustalenia | | właściciel |

## 4. Decyzje otwarte (produkt + prawnik)

- Czy pełne imię i nazwisko kandydata w e-mailu do firmy jest niezbędne. Szablony mają już
  neutralny wariant treści (bez nazwiska, z linkiem do panelu) — zmiana wymaga decyzji, nie
  nowego szablonu.
- Retencja `email_deliveries` (payload, błędy) i procedura przy żądaniu usunięcia (#486).
- Czy wysyłka e-maili z danymi kandydatów ma być wstrzymana konfiguracją, dopóki ocena
  dostawcy nie jest pozytywna (kryterium #503). Kod dziś nie ma takiej bramki — wymagałaby
  decyzji właściciela, bo bez niej poczta transakcyjna przestałaby wychodzić.
