# Import CV przez AI (#487, #498) — opis techniczny

Stan: 24.09.2026. Funkcja jest za flagą `AI_CV_IMPORT_ENABLED`, **domyślnie wyłączona**, także
w produkcji. Flaga jest osobna od importu ogłoszeń (`AI_JOB_IMPORT_ENABLED`, `docs/AI_JOB_IMPORT.md`),
bo import CV ma własną bramkę prawną. Ten dokument opisuje wyłącznie technikę. Wątki prawne
(podstawa przetwarzania, art. 9/10/14 RODO, dostawca i transfer) są w szkicu
`docs/legal-drafts/cv-ai-osoby-trzecie.md` i czekają na prawnika. Bez tej decyzji flagi nie
włączamy.

## Przepływ

Kandydat otwiera `/candidate/profil/import-cv` (link „Uzupełnij z CV” w profilu, widoczny tylko
z flagą). Bez flagi strona zwraca 404, a profil wypełnia się ręcznie w kreatorze.

| Krok | Co się dzieje | Model AI | Zapis |
|---|---|---|---|
| 1. Plik | PDF/DOCX ≤ 5 MB → tekst lokalnie na serwerze → minimalizacja | nie | nie |
| 2. Podgląd | kandydat widzi dokładny tekst do wysłania i liczniki usuniętych fragmentów | nie | nie |
| 3. „Wyślij do analizy” | serwer ponownie minimalizuje tekst, wysyła go do modelu, waliduje odpowiedź | tak | nie |
| 4. Propozycje | każda pozycja osobno, domyślnie niezaznaczona, ze źródłem w CV i oznaczeniem niepewności | nie | nie |
| 5. „Dodaj zaznaczone” | tylko zaznaczone pozycje → RPC `apply_candidate_cv_proposals` (0102) | nie | tak |

Pliku, tekstu CV ani propozycji nie zapisujemy. Przepływ nie tworzy rekordu `files`, nie
udostępnia CV firmom i nie zmienia widoczności profilu. Wynik nie trafia do `scoreMatch`,
rankingu ani screeningu. Ewentualne użycie do oceny kandydatów wymaga osobnej klasyfikacji
(AI Act, art. 22 RODO).

## Moduły

| Plik | Rola |
|---|---|
| `src/lib/cv-import/config.ts` | flaga, dostawca (`ANTHROPIC_API_KEY` albo atrapa poza produkcją), model |
| `src/lib/cv-import/text.ts` | tekst z PDF (`unpdf` = pdf.js 5, bez `eval`, bez XFA i sieci, ≤ 10 stron, 10 s) i DOCX (własny odczyt ZIP, tylko `word/document.xml`, limit 4 MB po dekompresji). DOC i skany → komunikat „wypełnij ręcznie” |
| `src/lib/cv-import/minimize.ts` | minimalizacja przed modelem (niżej) |
| `src/lib/cv-import/proposals.ts` | schemat structured output i walidacja odpowiedzi |
| `src/lib/cv-import/extract.ts` | wywołanie Claude (instrukcje w `system`, CV w `<cv>`, bez narzędzi) i atrapa `FixtureCvExtractor` |
| `src/lib/cv-import/run.ts` | etapy „podgląd” i „propozycje” bez autoryzacji |
| `src/lib/actions/cv-import.ts` | akcje: konto kandydata, limity, zapis zatwierdzonych |
| `src/components/candidate/CvImportPanel.tsx` | UI (styl panelu kandydata, `panel-styles.ts`) |

Reużyte: detektor `src/lib/privacy/sensitive-data.ts` (#495/#500 — NISS/BIS, PESEL, dokumenty,
e-mail, telefon), `ExtractorError` i model domyślny z importu ogłoszeń, sygnatury plików
z `src/lib/validation/cv-file.ts` (wspólne z uploadem CV), limiter `rate_limit_hit`.

## Minimalizacja (deterministyczna, przed modelem)

Ochrona nie opiera się na poleceniu w prompcie.

1. **Odmowa** przy numerze NISS/BIS, PESEL, karty eID lub dokumentu w dowolnym miejscu pliku
   (`CV_IMPORT_SENSITIVE_DATA`).
2. **Sekcje usuwane w całości**: referencje (nagłówki PL/NL/FR/EN/DE: „Referencje”, „References”,
   „Referenties”, „Références”…) do następnego znanego nagłówka oraz dane osobowe/kontakt
   (najwyżej 10 linii).
3. **Linie usuwane**: referencja, osoba kontaktowa, rola przełożonego z imieniem i nazwiskiem
   („Przełożony: Jan Kowalski”); data i miejsce urodzenia, stan cywilny, obywatelstwo, płeć,
   wiek, adres; kategorie szczególne — zdrowie/niepełnosprawność, religia, poglądy polityczne,
   związki zawodowe, pochodzenie etniczne, orientacja, karalność. Po etykiecie „Referencje:”
   usuwamy do 6 kolejnych linii.
4. **Znaczniki** zamiast e-maili, telefonów i linków.
5. **Bezpieczne zatrzymanie** (`CV_IMPORT_UNCERTAIN`): kontakt poza pierwszymi 8 liniami
   dokumentu albo więcej niż jeden adres e-mail. Wtedy nic nie wychodzi do dostawcy, a kandydat
   wypełnia profil ręcznie.

Heurystyki usuwają czasem za dużo (np. linię o opiece nad osobami niepełnosprawnymi). To
świadomy kompromis na rzecz ochrony danych. Kandydat może dopisać taką pozycję ręcznie.
Wynik to tylko liczby usuniętych fragmentów, bez wartości.

Serwer minimalizuje tekst dwa razy: przy podglądzie i ponownie przed modelem, bo tekst z podglądu
wraca z przeglądarki. Redakcja jest idempotentna.

## Walidacja odpowiedzi

- Schemat ma tylko pola: zawody, umiejętności, języki z poziomem, certyfikaty/uprawnienia, lata
  doświadczenia. Każda pozycja ma `evidence` (cytat) i `uncertain`.
- Limity jak w kreatorze (`CANDIDATE_ITEM_LIMITS`, 10/50/15/30), deduplikacja.
- Pozycja z e-mailem, telefonem, linkiem, znacznikiem redakcji, osobą trzecią albo kategorią
  szczególną jest pomijana. Numer identyfikacyjny w dowolnym miejscu odpowiedzi → odrzucenie
  całości.
- Cytat, którego nie ma w wysłanym tekście, nie jest pokazywany, a propozycja dostaje
  oznaczenie „do sprawdzenia”. Język bez poziomu → „podstawowy” + „do sprawdzenia”.
- Podejrzenie prompt injection → ostrzeżenie i wszystkie propozycje „do sprawdzenia”.

## Zapis (migracja 0102)

`apply_candidate_cv_proposals(p_occupations, p_skills, p_languages, p_certificates,
p_experience_years)` — SECURITY DEFINER, tylko `authenticated`, własny profil konta kandydata
(`ensure_candidate_profile`). Dopisuje, a nie zastępuje: istniejące pozycje, poziom ręcznie
wpisanego języka i data ważności certyfikatu zostają. Blokuje wiersz profilu (`FOR UPDATE`), więc
równoległy zapis kroku onboardingu nie ginie. Za długa pozycja, przekroczony limit albo brak
zatwierdzonych pozycji → `VALIDATION_FAILED`, bez częściowego zapisu. Dowód: `rls.sql` sekcja
CV487 (z kontrolą ujemną wersji replace-all).

Numer migracji jest tymczasowy — koordynator może go zmienić przy scalaniu.

## Limity i koszty

| Limit | Wartość |
|---|---|
| Plik | 5 MB, PDF/DOCX po sygnaturze; ≤ 10 stron PDF; tekst ≤ 30 000 znaków |
| Parsowanie lokalne | 20 / godz. na konto |
| Wywołania modelu | 5 / godz. i 10 / dobę na konto (bez IP), fail-closed |
| API | timeout 60 s, 1 ponowienie, `max_tokens` 6000, effort `low` |

Szacunek na wywołanie (Opus 5, ceny z `docs/AI_JOB_IMPORT.md`): ~3–9 tys. tokenów wejścia,
~1–3 tys. wyjścia → ok. 0,04–0,12 USD. Globalny budżet — #36.

## Telemetria

Treść CV nie trafia do logów, Sentry ani cache. `captureError` wysyła sam kod błędu (#508),
pdf.js działa z `verbosity: 0`. Atrapa i testy używają wyłącznie fikcyjnych danych
(`tests/helpers/cv-fixtures.ts`).

## Testy

- `tests/unit/cv-import-minimize.test.ts` — referenci, osoby trzecie, NISS, niepewność, art. 9/10.
- `tests/unit/cv-import-run.test.ts` — payload do modelu bez danych referentów; ponowna
  redakcja; walidacja odpowiedzi; prompt injection.
- `tests/unit/cv-import-run-control.test.ts` — kontrola ujemna: bez minimalizacji ta sama
  asercja wykrywa referentów w payloadzie.
- `tests/unit/cv-import-actions.test.ts` — flaga, rola, limity; brak zatwierdzenia = brak
  wywołania bazy; zapis tylko zatwierdzonych.
- `tests/unit/cv-import-text.test.ts` — PDF/DOCX, zły typ, DOC, skan, „zip bomb”.
- `tests/unit/cv-import-panel.test.tsx` — propozycje domyślnie niezaznaczone, zapis tylko
  zaznaczonych.
- `tests/e2e/cv-import.spec.ts` — atrapa dostawcy, PL/EN, PDF i DOCX, axe, NISS.
- `supabase/tests/rls.sql` sekcja CV487.

## Włączenie (decyzja właściciela)

1. Zatwierdzona analiza z `docs/legal-drafts/cv-ai-osoby-trzecie.md` (#485, #486, #488, #61).
2. Umowa i warunki transferu z dostawcą AI.
3. Zatwierdzone teksty informacyjne w UI (`cvImport.*`, PL/NL/FR/EN).
4. Dopiero potem `AI_CV_IMPORT_ENABLED=1` w Railway. Ta zmiana nie ustawia żadnych zmiennych.

## Otwarte

- Skan antywirusowy pliku (usługa zewnętrzna, jak P1-22-AV) i izolacja parsera w osobnym
  procesie. Dziś parser działa w procesie serwera z limitem czasu i rozmiaru.
- OCR skanów — celowo nie: skan bez tekstu kończy się komunikatem „wypełnij ręcznie”.
- Edycja wartości propozycji przed zatwierdzeniem (dziś: zaznacz/odznacz i poziom języka;
  poprawki w kreatorze).
