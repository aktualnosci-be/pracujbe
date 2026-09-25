# PROJEKT — do weryfikacji prawnika, nieopublikowany

> Szkic roboczy do issue #489. Nie jest opinią prawną, klasyfikacją ani decyzją DPIA. Część
> „Fakty” opisuje wyłącznie stan kodu na 2026-09-24 (commit bazowy `f1a1c73` + ta zmiana).
> Wszystkie oceny prawne są sformułowane jako pytania. Rozstrzyga osoba odpowiedzialna po
> weryfikacji przez prawnika; wtedy dokument dostaje wersję, datę i podpis.

| Pole | Wartość |
|---|---|
| Wersja | 0.1 (szkic) |
| Źródło faktów | kod repozytorium; inwentarz `src/lib/ai/inventory.ts` |
| Właściciel decyzji | _do uzupełnienia_ |
| Data weryfikacji terminu AI Act | _do uzupełnienia_ (issue #489 podaje: obowiązki dla przypadków z załącznika III od 2.12.2027 wg KE, stan 24.09.2026) |

## 1. Inwentarz przypadków użycia (fakty z kodu)

Pełna lista jest danymi w `src/lib/ai/inventory.ts`. Test `tests/unit/ai-inventory.test.ts`
skanuje `src/` i `scripts/` i nie przepuszcza pliku z wywołaniem modelu (import SDK dostawcy
AI albo adres jego API), który nie ma wpisu w inwentarzu. Test ma kontrolę ujemną.

### 1.1. Funkcje używające modelu językowego

| # | Funkcja | Status w kodzie | Dane wejściowe | Wynik | Człowiek w pętli (fakt) | Wpływ na kandydata (fakt) |
|---|---|---|---|---|---|---|
| A1 | Import ogłoszenia (#465, #469) | na `main`, za flagą `AI_JOB_IMPORT_ENABLED` (domyślnie wyłączona) | zrzut ekranu albo tekst strony ogłoszenia osoby trzeciej, dostarczony przez rekrutera | pola kreatora oferty + lista pól „do sprawdzenia” | tak: wynik trafia tylko do szkicu (`save_job_draft`); akcja nie woła `publish_job`; publikuje rekruter | brak: kod nie dotyka aplikacji, profili, dopasowań ani widoczności kandydatów (test) |
| A2 | Tłumaczenie treści (#31, #32) | otwarty PR #514; na tej gałęzi brak pliku | pola oferty (pracodawca) i pola profilu kandydata (kandydat) | tłumaczenie tych pól na inne języki portalu, po walidacji faktów | do potwierdzenia po scaleniu #514 (w inwentarzu: `humanInTheLoop: false`, korekta ręczna po fakcie) | do potwierdzenia po scaleniu #514 |
| A3 | Asystent redagowania oferty (#37, część pracodawcy) | ten PR, za flagą `AI_JOB_ASSIST_ENABLED` (domyślnie wyłączona) | tytuł, opis, obowiązki i wymagania obowiązkowe oferty wpisane przez rekrutera (e-maile, telefony, numery identyfikacyjne usuwane przed wysłaniem) | propozycja nowego brzmienia tych pól w języku oferty; propozycje z nowymi liczbami/linkami albo danymi kontaktowymi odrzuca serwer | tak: propozycja widoczna obok tekstu rekrutera; pole zmienia się dopiero po kliknięciu „Użyj propozycji”; akcja nic nie zapisuje i nie publikuje (test) | brak: wejście nie zawiera danych kandydatów (ścisły schemat, test); kod nie dotyka aplikacji, profili, dopasowań ani widoczności |
| A4 | Import CV do profilu (#487, #498) | za flagą `AI_CV_IMPORT_ENABLED` (domyślnie wyłączona) | tekst CV wgrany przez kandydata, po lokalnej minimalizacji (bez referentów, kontaktów, danych osobowych i kategorii szczególnych; NISS/BIS/dokument = odmowa); kandydat widzi tekst przed wysłaniem | propozycje pól profilu ze źródłem i niepewnością | tak: każda propozycja zatwierdzana osobno przez kandydata; bez zatwierdzenia brak zapisu (`apply_candidate_cv_proposals`) | brak: wynik nie trafia do firm, dopasowania, rankingu ani statusu aplikacji; szczegóły i pytania prawne: `docs/legal-drafts/cv-ai-osoby-trzecie.md` |

Dostawca wszystkich funkcji: Anthropic (Messages API). Model domyślny: `claude-opus-5` (A1, A4),
`claude-opus-5-5` (A3), nadpisywalny zmienną środowiskową. Model nie ma narzędzi; odpowiedź ogranicza schemat JSON.

Log użycia: od tej zmiany import ogłoszenia (A1) zapisuje jeden wiersz JSON na wywołanie
modelu (`src/lib/ai/usage-log.ts`): `type`, `at`, `feature`, `outcome`, `inputKind`, `model`,
`durationMs`. Bez treści, promptu, odpowiedzi, adresu URL, nazwy pliku, identyfikatora
użytkownika i firmy (test z kontrolą ujemną). A2 nie ma jeszcze logu (`usageLogged: false`). A4 zapisuje ten sam wiersz (`feature: cv_profile_import`, `inputKind: text`).

### 1.2. Funkcje dotyczące kandydatów, które NIE używają modelu

| # | Funkcja | Fakt z kodu | Kto widzi wynik |
|---|---|---|---|
| D1 | `scoreMatch` (`src/lib/matching/score.ts`) | czysta, deterministyczna funkcja; stałe wagi (CLAUDE.md §8); brak I/O i losowości | kandydat na szczególe oferty („Twoje dopasowanie”) |
| D2 | Tabela `matches` + `get_company_top_matches` | pulpit pracodawcy pokazuje 5 kandydatów z najwyższym `matches.score` (recruiter+, firma `verified`, kandydat widoczny/niezablokowany). W repozytorium `matches` wypełnia wyłącznie seed demonstracyjny; nie ma procesu, który liczy i zapisuje dopasowania w produkcji (P1-03) | pracodawca |
| D3 | `applications.match_score` | wyświetlane w szczególe zgłoszenia; triggery zerują wartość podaną przez klienta, w kodzie brak zapisu tej kolumny | pracodawca |
| D4 | Status aplikacji | zmienia wyłącznie rekruter (`transition_application`, recruiter+); w bazie brak automatycznego odrzucenia | kandydat, pracodawca |
| D5 | Pytania screeningowe (#101) | odpowiedzi zapisane jako snapshot i pokazane rekruterowi; bez reguł dyskwalifikujących; nie zmieniają dopasowania ani statusu | pracodawca, kandydat |
| D6 | Alerty wyszukiwań (#100) | te same filtry co lista ofert; dotyczy ofert, nie ocenia kandydata | kandydat |
| D7 | Kolejka moderacji (#42) | `flag_report_for_review` tylko ustawia flagę i priorytet; decyzję podejmuje admin | admin |

Test `ai-inventory.test.ts` sprawdza, że pliki D1, D4–D6 nie wołają modelu.

### 1.3. Zastosowania z issue, których w kodzie nie ma

- import CV do własnego profilu kandydata — brak;
- ranking kandydatów przez AI, automatyczne odrzucanie, ukrywanie kandydatów — brak;
- automatyczne pytania screeningowe generowane przez AI — brak (pytania pisze rekruter).

## 2. Pytania do prawnika — AI Act

1. Czy A1 (import ogłoszenia do szkicu oferty) jest systemem AI w rozumieniu art. 3 pkt 1,
   a jeśli tak, czy mieści się w załączniku III pkt 4(a) („publikowanie ukierunkowanych
   ogłoszeń”)? Czy ma znaczenie, że wynik to szkic, który rekruter poprawia i publikuje sam?
2. Jeśli A1 mieści się w załączniku III pkt 4(a): czy stosuje się wyjątek z art. 6 ust. 3
   (np. lit. a „wąskie zadanie proceduralne” albo lit. d „zadanie przygotowawcze”)? Funkcja nie
   przetwarza danych kandydatów ani nie profiluje osób (fakt: 1.1).
3. Jaką rolę pełni platforma dla A1 i A2 (dostawca / podmiot stosujący), a jaką pracodawca,
   który klika „Zaimportuj”? Czy rola jest inna dla każdej z funkcji?
4. Czy A2 (tłumaczenie profilu kandydata) jest „oceną” lub „filtrowaniem” w rozumieniu
   załącznika III pkt 4(a), jeśli tylko zmienia język tekstu? Czy odpowiedź zależy od tego, czy
   tłumaczenie trafia do pracodawcy bez przeglądu kandydata?
5. Czy D1/D2 (deterministyczne dopasowanie ze stałymi wagami, bez uczenia) są „systemem AI”
   w rozumieniu art. 3 pkt 1 i wytycznych KE w sprawie definicji systemu AI?
6. Jakie obowiązki z art. 50 (przejrzystość) dotyczą A1 i A2, jeśli nie są systemami wysokiego
   ryzyka? Czy treść wygenerowana w A1 wymaga oznaczenia na opublikowanej ofercie?
7. Od kiedy stosują się obowiązki dla przypadków z załącznika III i czy termin z issue
   (2.12.2027) jest aktualny na dzień weryfikacji?

## 3. Pytania do prawnika — art. 22 RODO

1. Czy którakolwiek funkcja z 1.1 lub 1.2 podejmuje decyzję „opartą wyłącznie na
   zautomatyzowanym przetwarzaniu” wobec kandydata? Fakt: status aplikacji zmienia tylko
   rekruter (D4); brak automatycznego odrzucenia.
2. Czy pulpit „najlepiej dopasowani kandydaci” (D2) — ranking 5 osób wg wyniku, bez decyzji —
   jest profilowaniem w rozumieniu art. 4 pkt 4, a jeśli tak, czy wpływa na kandydata
   „w podobnie istotny sposób” (ekspozycja przed pracodawcą)?
3. Czy wynik dopasowania pokazywany rekruterowi (D3) może faktycznie przesądzać o decyzji
   (automation bias) na tyle, że decyzję trzeba traktować jak zautomatyzowaną? Jakie środki są
   wymagane, by nadzór człowieka był rzeczywisty (kompetencje, możliwość zmiany, uzasadnienie)?
4. Jakie informacje o logice dopasowania (art. 13 ust. 2 lit. f, art. 15 ust. 1 lit. h) należą
   się kandydatowi, jeśli D1/D2 są profilowaniem?

## 4. Pytania do prawnika — DPIA (art. 35 RODO, lista APD)

1. Czy dla A1, A2 lub D1–D3 przesłanki z art. 35 ust. 3 lub z belgijskiej listy APD wymagają
   DPIA przed uruchomieniem? Które kryteria są spełnione (ocena/scoring, dane na dużą skalę,
   nowe technologie, osoby w słabszej pozycji — np. osoby szukające pracy)?
2. A1: materiał ogłoszenia może zawierać dane kontaktowe osób trzecich. Fakt (#495/#500,
   `src/lib/ai-import/minimize.ts`): z tekstu strony przed wysłaniem usuwane są e-maile,
   telefony, NISS/BIS, PESEL i numery dokumentów, a do promptu trafia tylko nazwa hosta
   źródła; zrzutu ekranu nie da się tak zredagować (brak lokalnego OCR) — działa walidacja
   wyjścia i odmowa importu przy numerze identyfikacyjnym. Czy to wystarcza, czy zrzut
   ekranu wymaga osobnej oceny?
3. A1/A2: przekazanie do dostawcy modelu. Jakie dokumenty są potrzebne przed włączeniem flagi
   w produkcji (umowa powierzenia, region, retencja po stronie dostawcy, transfer poza EOG)?
   Stan: `docs/AI_JOB_IMPORT.md` §„Prywatność” wymienia to jako warunek przed włączeniem.
4. Czy log użycia (1.1) jest wystarczający jako „log” dla celów nadzoru i rozliczalności, czy
   potrzebny jest dłuższy przechowywany zapis (i jaka retencja)? Log trafia dziś na standardowe
   wyjście procesu (logi hostingu); retencja zależy od Railway.
5. Jeśli DPIA wykaże wysokie ryzyko, którego nie da się ograniczyć: czy i kiedy stosuje się
   art. 36 (uprzednie konsultacje z APD)?

## 5. Stan techniczny do czasu decyzji

- Brak rankingu AI, automatycznego odrzucania i ukrywania kandydatów (fakt, 1.3). Nowe
  wywołanie modelu bez wpisu w inwentarzu zatrzymuje CI.
- Plik D1/D4–D6, który zacząłby wołać model, zatrzymuje CI i wymusza wpis w inwentarzu oraz
  aktualizację tego szkicu.
- A1 i A2 są domyślnie wyłączone flagami środowiskowymi.

## 6. Do uzupełnienia po decyzji

| Przypadek | Klasyfikacja AI Act | Art. 22 | DPIA tak/nie | Uzasadnienie | Podpis / data |
|---|---|---|---|---|---|
| A1 | | | | | |
| A2 | | | | | |
| D1 | | | | | |
| D2 | | | | | |
| D3 | | | | | |
