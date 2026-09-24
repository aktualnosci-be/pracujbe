# PROJEKT — do weryfikacji prawnika, nieopublikowany

> **Status:** roboczy szkic przygotowany przez zespół techniczny (#486). To **nie jest**
> obowiązująca polityka prywatności ani polityka retencji Pracuj.be i nie może być
> publikowany, cytowany kandydatom ani traktowany jako zobowiązanie. Okresy w tabeli są
> **propozycjami do dyskusji**. Treść prawna dla kandydatów powstaje w #61 po zatwierdzeniu
> przez administratora danych. Stan techniczny opisuje
> [docs/DATA_RETENTION.md](../DATA_RETENTION.md).

## 1. Po co ten dokument

Zebrać w jednym miejscu, jakie dane kandydata system przetwarza, co technicznie potrafi
usunąć i kiedy, oraz jakie decyzje musi podjąć administrator danych, zanim platforma
zacznie przyjmować realne CV. Źródła wskazane w #486: RODO art. 5(1)(c),(e), 12–22, 25,
32; APD (Belgia) o minimalizacji danych kandydatów; EROD, wytyczne 01/2022 o prawie
dostępu. Szkic celowo **nie** podaje „ustawowego belgijskiego terminu retencji CV” —
w #486 wskazano, że takiego uniwersalnego terminu nie należy zakładać; okres wynika z celu.

## 2. Mapa danych (do weryfikacji)

| Kategoria | Gdzie | Kto decyduje o celu (do potwierdzenia) | Uwagi |
|---|---|---|---|
| Konto (e-mail, hasło, sesje) | `auth.users`, `auth.accounts`, `auth.sessions` | platforma | usuwane z kontem |
| Profil zawodowy (zawody, umiejętności, języki, certyfikaty, dostępność) | `profiles`, `candidate_profiles`, relacje | platforma | edytowalny przez kandydata |
| CV (plik) i metadane | bucket `candidate-files`, `files` | platforma | dostęp tylko kandydata (#26) |
| Aplikacje, historia statusów, odpowiedzi screeningowe | `applications`, `application_status_history`, `application_screening_answers` | platforma **i** pracodawca (#485) | pracodawca może być odrębnym administratorem |
| Propozycje pracy | `offers`, `offer_status_history` | jw. | |
| Wiadomości | `conversations`, `messages` | jw. | zawierają dane obu stron |
| Wyniki dopasowania | `matches` | platforma | dane pochodne; deterministyczny scoring |
| Zgłoszenia bez konta | `guest_application_requests` | platforma | snapshot zgody, IP, UA |
| Powiadomienia, e-maile | `notifications`, `email_deliveries` | platforma | treść e-maili nie jest przechowywana poza payloadem |
| Zgody i akceptacje | `consents`, `document_acceptances` | platforma | dowód — okres do ustalenia |
| Zgłoszenia DSA | `reports`, `report_events` | platforma (obowiązek DSA) | zostają po usunięciu konta, bez powiązania |
| Audyt | `audit_logs` | platforma | po usunięciu konta bez IP/UA |
| Ślad obsługi wniosków | `data_rights_requests` | platforma | bez treści danych |
| Rejestr usunięć | `erasure_tombstones` | platforma | same UUID, do ponownego usunięcia po restore |
| Kopie zapasowe | zaszyfrowane artefakty `age` | platforma | retencja = liczba kopii (`BACKUP_RETENTION`, domyślnie 14) |

## 3. Propozycja okresów (do decyzji)

System ma okres każdej kategorii jako dane (`retention_policies`); kategoria bez
zatwierdzonego okresu jest **wyłączona**. Kolumna „Propozycja” to punkt wyjścia do
rozmowy, nie wartość ustawiona w systemie (poza wierszami oznaczonymi „ustawione”).

| Kategoria | Propozycja | Stan w systemie | Pytanie do prawnika |
|---|---|---|---|
| Plik oznaczony jako usunięty | 30 dni (okno techniczne) | ustawione | czy 30 dni jest proporcjonalne |
| Profil oznaczony jako usunięty (np. przez admina) | 30 dni | ustawione | jw. |
| Samoobsługowe usunięcie konta | natychmiast (jedna transakcja); obiekty storage asynchronicznie z ponowieniami | działa | czy potrzebne okno na cofnięcie |
| Aplikacja odrzucona / wycofana / propozycja odrzucona | np. 6–12 miesięcy od ostatniej zmiany | wyłączone | cel i podstawa (roszczenia, ponowna rekrutacja?) |
| Aplikacja zakończona zatrudnieniem | do ustalenia | brak zadania | czy platforma w ogóle powinna ją trzymać |
| CV nieaktywnego kandydata | np. 24 miesiące bez aktywności | wyłączone | kryterium aktywności; uprzedzenie przed usunięciem |
| Zgłoszenie bez konta — niepotwierdzone / duplikat | 7 dni | działa (#98) | — |
| Zgłoszenie bez konta — potwierdzone | np. 30 dni po zamknięciu okna przejęcia | wyłączone | które pola snapshotu zgody są potrzebne i jak długo (#486, komentarz z 24.09) |
| Ślad obsługi wniosku | np. 3 lata | wyłączone | okres dowodowy |
| Rejestr usunięć | co najmniej retencja kopii + margines (system wymusza ≥ 400 dni) | bez limitu | czy pseudonimowy UUID bezterminowo jest dopuszczalny |
| Kopie zapasowe | 14 kopii dziennych | skrypt | okres i miejsce przechowywania |
| Zgody / akceptacje dokumentów | do ustalenia | brak zadania | okres dowodowy |

## 4. Prawa kandydata — co system robi dziś

- **Dostęp / kopia (art. 15, 20):** samoobsługowy eksport JSON w ustawieniach konta
  (zakres: [DATA_RETENTION.md §4](../DATA_RETENTION.md)). Obejmuje dane podane, dane procesu
  i zapisane wyniki dopasowania; pomija identyfikatory innych osób. Do decyzji: czy
  zakres art. 20 różni się od art. 15 i czy eksport JSON wystarcza jako „zrozumiała forma”
  (dziś bez opisów pól dla kandydata).
- **Sprostowanie (art. 16):** kandydat edytuje profil. Brak formularza sprostowania danych
  pochodnych (wynik dopasowania wynika z profilu i oferty).
- **Usunięcie (art. 17):** samoobsługowe, z potwierdzeniem adresem e-mail konta; obejmuje
  dane procesu widoczne dla firmy w serwisie. Nie obejmuje kopii zrobionych przez
  pracodawcę poza serwisem — do opisania granica i droga kontaktu z pracodawcą.
- **Ograniczenie / sprzeciw (art. 18, 21):** brak funkcji; zależy od wybranej podstawy
  prawnej przetwarzania.
- **Termin (art. 12(3)):** wniosek samoobsługowy jest realizowany od razu; system zapisuje
  `due_at` = miesiąc od wniosku na potrzeby wniosków obsługiwanych ręcznie.
- **Weryfikacja tożsamości:** aktywna sesja + wpisany adres konta. Do oceny, czy
  wystarcza, czy potrzebny link e-mail.

## 5. Kopie zapasowe

Usunięcie nie zmienia istniejących kopii. Przy odtworzeniu kopii system ponownie usuwa
osoby z rejestru usunięć (test automatyczny). Do zatwierdzenia: okres przechowywania
kopii, opis tej procedury w informacji dla kandydata, harmonogram eksportu rejestru.

## 6. Pytania otwarte

1. Podstawa prawna przetwarzania dla każdej kategorii z §2 (art. 6) i rozdział ról
   platforma / pracodawca (#485).
2. Zatwierdzenie okresów z §3 albo obiektywnych kryteriów zakończenia przechowywania.
3. Zakres informacji dla kandydata (#61, #493) — wyłącznie to, co system faktycznie robi.
4. Czy usunięcie konta ma powiadamiać firmy, którym kandydat wysłał aplikację.
5. Czy eksport ma zawierać opis pól w języku kandydata.
