# ESCO v1.2.1 — taksonomia zawodów i umiejętności (#93)

Portal trzyma wspólną taksonomię zawodów i umiejętności z **przypiętego snapshotu
ESCO v1.2.1**, w językach portalu: **PL, NL, FR, EN**. Czyta ją lokalnie z PostgreSQL,
bez wywołań API ESCO w ścieżce użytkownika.

Issue #93 wymienia sześć języków (także RO i UK). Właściciel zdecydował, że portal
obsługuje tylko cztery, więc RO/UK nie są importowane. Baza sama odrzuca etykietę
w innym języku (FK do `supported_locales`). Dodanie języka wymaga nowej migracji
`supported_locales` i ponownego przypięcia manifestu z plikami tego języka.

UI i automatyczny matching na tej taksonomii są poza zakresem (osobne issues).
Import nie zmienia profili, ofert, aplikacji ani dopasowań (dowód: `rls.sql` ESCO93-8).

## Model danych (migracja `0098_esco_taxonomy.sql`)

| obiekt | zawartość |
|---|---|
| `esco_snapshots` | identyfikator snapshotu, `esco_version`, `is_sample`, języki, pliki z SHA-256 i rozmiarem, skrót manifestu, atrybucja, liczba i daty importów, ostatni raport |
| `occupations` / `skills` (nowe kolumny) | `source` (`manual` \| `esco`), `esco_uri` (stabilny klucz, unikalny), `esco_code`, `isco_group` / `skill_type`, `reuse_level`, `esco_snapshot_id` |
| `occupation_labels` / `skill_labels` | etykieta `preferred` (najwyżej jedna na język) i `alternative`; język = FK do `supported_locales` |
| `occupation_skills` | relacja zawód–umiejętność: `essential` (podstawowa) albo `optional` (opcjonalna) |
| `occupation_label(id, locale)` / `skill_label(id, locale)` | etykieta z fallbackiem |

- Wiersze ESCO mają slug `esco-<uuid z URI>`, a `name` = preferowana etykieta EN.
- Istniejące słowniki z `0010` mają `source = 'manual'` i import ich nie zmienia.
- Uprawnienia: odczyt dla wszystkich (`anon`, `authenticated`). Zapis i RPC importu
  (`esco_begin_snapshot`, `esco_upsert_occupations`, `esco_upsert_skills`,
  `esco_upsert_relations`, `esco_finish_snapshot`) ma tylko `service_role`.
- Fragment testowy ma `is_demo = true` (Invariant #12). Po realnym imporcie te same
  wiersze dostają `is_demo = false`.

### Fallback etykiet (deterministyczny)

Kolejność: preferowana etykieta w żądanym języku → preferowana etykieta `en` →
`occupations.name` / `skills.name`. Nieobsługiwany albo pusty (`NULL`) język od razu
daje `en`.

## Przypięcie i idempotencja

1. **Wersja** jest przypięta w kodzie (`ESCO_VERSION = 'v1.2.1'` w
   `scripts/esco/lib/snapshot.mjs`) i w bazie (CHECK na `esco_snapshots.esco_version`).
2. **Zawartość plików** przypina manifest: SHA-256 i rozmiar każdego CSV.
   Importer odmawia, gdy plik różni się od manifestu.
3. **Baza przypina manifest przy pierwszym imporcie.** Ten sam snapshot z innymi
   plikami, drugi realny snapshot tej samej wersji albo zmiana pól przypięcia kończą
   się błędem `ESCO_CHECKSUM_MISMATCH`.
4. **Upsert po `esco_uri`.** Etykiety i relacje koncepcji ESCO działają w trybie
   replace-all. Ponowny import tego samego snapshotu daje zero zmian (zmierzone niżej).
5. Koncepcja ESCO, której nie ma w nowym snapshocie, dostaje `is_active = false`
   i nie jest usuwana: `candidate_skills.skill_id` i `job_skills.skill_id` mają do
   niej FK. Relacje spoza snapshotu są usuwane.
6. Cały import jest jedną transakcją. Błąd w dowolnym kroku cofa wszystko.

### Dane ręczne

Zdarza się, że wiersz `manual` ma ten sam `esco_uri` co koncepcja z paczki. Domyślnie
(`--manual=fail`) import wtedy kończy się błędem `ESCO_MANUAL_CONFLICT` i nic nie
zapisuje. Dalej trzeba zdecydować jawnie:

- `--manual=skip` zostawia wiersz ręczny razem z jego etykietami. Relacje ESCO do
  tego wiersza są pomijane i trafiają do raportu (`manualSkipped`).
- `--manual=overwrite` przejmuje wiersz jako ESCO: nadpisuje `name`, kody i etykiety.

Import nigdy nie nadpisuje slugów i ręcznych relacji (`occupation_skills.source = 'manual'`).

## Pełny import — krok po kroku (właściciel)

Paczki ESCO pobiera się przez formularz na
<https://esco.ec.europa.eu/en/use-esco/download>. Link do pliku przychodzi e-mailem,
więc nie da się go zautomatyzować z CI ani z sesji bez skrzynki pocztowej.

1. W formularzu wybierz dla każdego języka **pl, nl, fr, en**: *Version:* `ESCO dataset - v1.2.1`,
   *Content:* `classification`, *Language:* dany język, *File type:* `csv`.
2. Rozpakuj wszystkie paczki do jednego katalogu poza repozytorium albo do `.esco/`
   (jest w `.gitignore`). Importer potrzebuje plików `occupations_<l>.csv` i
   `skills_<l>.csv` dla czterech języków oraz `occupationSkillRelations_en.csv`.
   Relacje w innych językach są opcjonalne; jeśli są, importer porównuje je z EN.
   Paczka może mieć też inne pliki — importer je pomija.
3. Przypnij snapshot (jednorazowo) i zatwierdź manifest w repozytorium:
   ```bash
   npm run esco:import -- manifest --dir .esco/v1.2.1 --out data/esco/esco-v1.2.1.manifest.json
   ```
   Kolejne pobrania i inne środowiska są weryfikowane względem tego pliku.
4. Sprawdź pliki bez bazy: sumy, parser i raport brakujących tłumaczeń.
   ```bash
   npm run esco:import -- verify --dir .esco/v1.2.1 --report esco-report.json
   ```
5. Wykonaj próbę na docelowej bazie (pełny import zakończony `ROLLBACK`), a potem import:
   ```bash
   ESCO_IMPORT_DATABASE_URL=… npm run esco:import -- import --dir .esco/v1.2.1 --dry-run
   ESCO_IMPORT_DATABASE_URL=… npm run esco:import -- import --dir .esco/v1.2.1 --report esco-import.json
   ```
   `ESCO_IMPORT_DATABASE_URL` to login uprzywilejowany z prawem `SET ROLE service_role`
   (np. login migratora). Nie używaj loginów runtime z `db:logins`. Migracja `0098`
   musi być już zastosowana.
6. Jeśli import zgłosi `ESCO_MANUAL_CONFLICT`, zdecyduj: `--manual=skip` albo `--manual=overwrite`.

Import można powtarzać: ten sam manifest daje status `repeat` i zero zmian.

Parser i sumy kontrolne sprawdziły tylko fragment testowy zbudowany z API ESCO
(niżej). Nazwy kolumn oficjalnych CSV v1.2.1 nie zostały porównane z prawdziwymi
plikami. Jeśli w pliku brakuje wymaganej kolumny, `verify` zakończy się błędem
z jej nazwą: `conceptType`, `conceptUri`, `preferredLabel`, `altLabels`, `status`,
`code`/`iscoGroup` (zawody), `skillType`/`reuseLevel` (umiejętności), `occupationUri`,
`relationType`, `skillUri` (relacje). Zrób wtedy poprawkę parsera w osobnym PR.

## Raport importu

`verify` i `import` wypisują JSON z:

- liczbami zawodów, umiejętności i relacji (`essential` / `optional`);
- liczbą brakujących tłumaczeń na język (`missingTranslations`, a przy `--report`
  także listą URI);
- licznikami `inserted`, `updated`, `labelsAdded`, `labelsRemoved` i `manualSkipped`;
- liczbami koncepcji wyłączonych i relacji usuniętych;
- czasami kroków w ms.

Skrót raportu trafia do `esco_snapshots.last_report`.

## Pomiar (PostgreSQL 16, kontener sesji)

Dane syntetyczne w skali ESCO v1.2.x: 3039 zawodów, 13 939 umiejętności, 124 599
relacji, 4 języki. Zawód ma 1 etykietę preferowaną i 5 alternatywnych na język,
umiejętność 1 i 3. Razem ok. 296 tys. etykiet, 34 MB CSV.

| przebieg | czas importu | zmiany |
|---|---|---|
| pierwszy (`new`) | ~15 s (zawody 2,3 s, umiejętności 8,2 s, relacje 3,9 s); ~20 s z parsowaniem | 3039 + 13 939 koncepcji, 295 960 etykiet, 124 599 relacji |
| ponowny (`repeat`) | ~4,6 s; ~9 s z parsowaniem | 0 |

Rozmiar w bazie (z indeksami): `skill_labels` 50 MB, `occupation_skills` 21 MB,
`occupation_labels` 18 MB, `skills` 12 MB, `occupations` 2,6 MB — razem ok. 104 MB.
Prawdziwe pliki mają inną liczbę etykiet alternatywnych, więc właściciel powinien
zapisać czasy z raportu pełnego importu.

## Fragment testowy (jawnie oznaczony)

`tests/fixtures/esco/esco-v1.2.1-sample/` i `esco-v1.2.1-sample.manifest.json`
(snapshot `esco-v1.2.1-sample`, `sample: true`) to **nie jest oficjalny plik wydania**.
Fragment zawiera prawdziwe dane ESCO v1.2.1 z publicznego API ESCO
(`selectedVersion=v1.2.1`) w układzie kolumn paczki CSV: 5 zawodów z grupy docelowej
portalu, 22 umiejętności i 24 relacje. Zbudował go `scripts/esco/build-sample-fixture.mjs`.

- Import fragmentu wymaga `--allow-sample`.
- Wiersze fragmentu dostają `is_demo = true`.
- Baza odrzuca fragment po realnym imporcie (`ESCO_SAMPLE_AFTER_REAL`).

Testy:

- `tests/unit/esco-snapshot.test.ts` — parser, manifest, sumy i orkiestracja importu.
- `supabase/tests/rls.sql`, sekcja ESCO93 — uprawnienia, przypięcie, idempotencja,
  dane ręczne, fallback, brak wpływu na dane procesowe, rollback.
- `npm run test:esco` (`scripts/esco/test-esco-import.mjs`) — pełny pipeline na
  pustej bazie `pracujbe_esco_test`.

## Rollback

`supabase/rollback/0098_esco_taxonomy.down.sql` uruchamia się ręcznie jako migrator
w jednej transakcji (`psql -1 -f …`). Usuwa wiersze ESCO, etykiety, relacje,
metadane, funkcje i kolumny 0098. Wiersze ręczne zostają. W profilach i ofertach
zostają etykiety tekstowe (`skill_label`), a `skill_id` przechodzi na `NULL` (FK
`ON DELETE SET NULL`). Po rollbacku usuń wpis `0098_esco_taxonomy.sql` z
`app_migrations.history`. Dowód działania: `rls.sql` ESCO93-R, gdzie rollback
wykonuje się w transakcji i jest cofany.

## Licencja i atrybucja ESCO

Źródło: [ESCO — FAQ](https://esco.ec.europa.eu/en/about-esco/faq), pytanie „What license
agreement am I bound to and how should this be referred to?” (sprawdzone 2026-09-24).
Cytaty dosłowne:

- *„In accordance with the Commission Decision of 12 December 2011 on the reuse of
  Commission documents (2011/833/EU), the ESCO classification can be downloaded, used,
  reproduced and reused for any purpose and by any interested party free of charge.
  It may be linked with existing taxonomies or classifications for supplementing and
  mapping purposes. Any use is subject to the following conditions:”*
- *„1) The use of ESCO shall be acknowledged by publishing the statement below:
  For services, tools and applications integrating totally or partially ESCO: "This
  service uses the ESCO classification of the European Commission."”* (dla studiów
  i raportów: *„This publication uses the ESCO classification of the European
  Commission.”*). Na stronie ESCO słowa „ESCO classification” są linkiem do ESCO.
- *„2) Any modified or adapted version of ESCO must be clearly indicated as such.”*

Co z tego wynika dla portalu:

- Tekst atrybucji jest zapisany w `esco_snapshots.attribution`.
- Wyświetlenie go w UI (stopka albo strona „O nas”, w językach portalu) należy do
  osobnego issue UI. Tłumaczenie atrybucji nie powinno zmieniać jej treści.
- Import nie modyfikuje etykiet ESCO: jedynie usuwa skrajne spacje i normalizuje
  zapis do Unicode NFC.
- Wiersze ręczne (`source = 'manual'`) i wiersze przejęte przez `--manual=overwrite`
  nie są etykietami ESCO. Gdy UI będzie je pokazywać obok danych ESCO, powinno je
  oznaczyć jako zmienione albo własne.

Licencja oprogramowania API ESCO nie dotyczy tego importu: portal nie używa API
w działaniu, a jedynie `build-sample-fixture.mjs` odczytuje API do zbudowania
fragmentu testowego.
