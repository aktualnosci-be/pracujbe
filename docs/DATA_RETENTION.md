# Retencja danych i prawa kandydata — część techniczna (#486)

Opis tego, co system **robi**. Okresy przechowywania i treść informacji dla kandydatów
zatwierdza administrator danych; roboczy projekt dla prawnika jest w
[legal-drafts/retencja-i-prawa-kandydata.md](legal-drafts/retencja-i-prawa-kandydata.md)
(nieopublikowany). W interfejsie są tylko neutralne etykiety funkcji (`accountData.*`).

Migracje: `supabase/migrations/0105_data_retention_rights.sql` (mechanizm) i
`supabase/migrations/0129_retention_values.sql` (#574 — wartości z opracowania 2026-09-25,
brakujące zadania, dead-letter kolejki storage).

> **Harmonogram jest WYŁĄCZONY.** Wartości z opracowania (#573, decyzja właściciela
> 25.09.2026) są w bazie, ale `/api/maintenance` woła `run_retention_purge` dopiero przy
> jawnym `RETENTION_MODE=dry-run` albo `apply` (`src/lib/retention/mode.ts`). Brak zmiennej
> albo inna wartość = żadne zadanie retencji nie działa — także sprzątanie plików i profili
> oznaczonych do usunięcia. Harmonogram włącza właściciel po akceptacji testów RET-01…RET-13
> (`legal-drafts/opracowanie-2026-09-25/wdrozenie/checklista-odbioru.md`) i danych operatora.
> Kolejka fizycznego usuwania obiektów storage działa niezależnie od flagi (obsługuje też
> usunięcie konta na wniosek).

## 1. Okresy retencji jako dane

`public.retention_policies` — klucz kategorii → `period` (`interval`, 1–3650 dni) albo
`null` (zadanie wyłączone), `warning_period` (ostrzeżenie przed usunięciem albo próg alarmu)
i `enforcement` (kto egzekwuje: `job` = `run_retention_purge`, `monitoring` = czujka
`ops_metrics`, `infrastructure` = poza bazą, `none` = brak zadania). Zmiana tylko przez
`admin_set_retention_policy(key, days)` (`is_admin()`, wpis `retention.policy_changed` w
`audit_logs`); wartości z 0129 zapisał wpis `retention.policies_seeded`. Rejestru usunięć
nie da się skrócić poniżej 400 dni (musi przeżyć najstarszą kopię) — zmiana tego minimum
dopiero po RET-09/RET-10, osobnym krokiem. Tabela jest niedostępna dla ról klienta.

| Klucz | Wartość (0129) | Egzekwuje | Co robi zadanie |
|---|---|---|---|
| `deleted_file` | 7 dni | job | wiersz `files` z `deleted_at` usuwany o `storage_physical_deletion` wcześniej (po 4 dniach), obiekt z kolejki — razem ≤ 7 dni |
| `deleted_profile` | 7 dni | job | pełne usunięcie kandydata z `profiles.deleted_at` (jak wyżej, 4 dni + kolejka) |
| `closed_application` | 180 dni | job | aplikacja w **każdym** stanie końcowym (`rejected`, `withdrawn`, `hired`, `offer_accepted`, `offer_declined`) od `closed_at`, razem z rozmowami tej aplikacji (wiadomości), powiadomieniami i e-mailami; ślad gościa traci powiązanie |
| `inactive_candidate_cv` | 365 dni, ostrzeżenie 30 | job | e-mail `inactiveCvWarning`, po terminie usunięcie pliku CV (obiekt → kolejka) |
| `inactive_candidate_account` | 730 dni, ostrzeżenie 30 | job | e-mail `inactiveAccountWarning`, po terminie `erase_candidate_subject` (kanał `retention`) |
| `inactive_searchable_profile` | 180 dni | job | ukrycie profilu w wyszukiwarce firm (`is_searchable = false`, wpis `candidate_visibility_events`) |
| `confirmed_guest_request` | 30 dni | job | usuwa potwierdzone zgłoszenie bez konta (bufor, nie aplikacja) od `confirmed_at` z jego e-mailami; aplikacja zostaje ze snapshotem gościa |
| `unconfirmed_guest_request` | 7 dni | job | niepotwierdzone zgłoszenie usuwane 7 dni od **pierwszego** wysłania (`created_at`) — ponowny link nie przedłuża |
| `guest_ip_user_agent` | 7 dni | job | zeruje IP i user-agent zgody gościa |
| `data_rights_request_log` | 1095 dni | job | usuwa ślad obsługi wniosku |
| `erasure_tombstone` | wyłączone (bez limitu) | job | usuwa wpis rejestru usunięć — **bez zmian** do RET-09/RET-10 |
| `storage_physical_deletion` | 3 dni (72 h), alarm 1 dzień | monitoring | cel fizycznego usunięcia obiektu; czujka `storage_deletion_age` po 24 h |
| `consent_evidence` | 1095 dni | none | dowody zgód i akceptacji — brak zadania (receipty niezmienne), osobny krok |
| `audit_log` | 365 dni | none | zminimalizowany audyt — brak zadania (uzasadnienia DSA), osobny krok |
| `security_log` | 30 dni | infrastructure | surowe logi Railway — ustawienie dostawcy |
| `database_backup` | 14 dni kalendarzowych | infrastructure | kopie i eksporty (`scripts/db/backup.sh` liczy dziś kopie, nie dni — RET-09) |

Zadania dla `job` działają dopiero przy `RETENTION_MODE=apply` (patrz ramka wyżej).

### 1a. Niezmienny `closed_at` aplikacji (RET-06)

`applications.closed_at` ustawia trigger `trg_applications_closed_at` przy wejściu w stan
końcowy. Zmiana w obrębie stanów końcowych, odczyt, powiadomienie, `updated_at` ani zapis
wprost go nie przesuwają. Wyjście ze stanu końcowego (dziś niedozwolone przez
`transition_application`) zeruje go i jest audytowane (`application.status_changed`, 0017).
Istniejące aplikacje dostały czas wejścia w bieżący status z historii (inaczej `updated_at`).

### 1b. Aktywność i ostrzeżenia (RET-05)

`profiles.last_seen_at` ustawia trigger na `auth.sessions`: utworzenie sesji Better Auth
(logowanie) i jej odświeżenie przy używaniu (`expires_at`), najwyżej raz na godzinę. Zadania
tła (service_role) nie dotykają sesji, więc nie przedłużają aktywności; brak zgody na
telemetrię nie ma znaczenia (to nie telemetria).

Przed usunięciem CV albo konta zadanie zapisuje `retention_warnings` (kandydat, kategoria,
aktywność, termin = później z `aktywność + okres` i `teraz + 30 dni`) i kolejkuje e-mail
w języku odbiorcy (Invariant #1) z datą usunięcia. Usunięcie następuje dopiero po terminie
z ostrzeżenia; nowa aktywność unieważnia ostrzeżenie (wiersz znika, następne dopiero po
kolejnym okresie). Treść e-maili (`src/emails/copy.ts`) do akceptacji właściciela.

## 2. Zadanie w `/api/maintenance`

Po dotychczasowych zadaniach, tylko przy `RETENTION_MODE`:

- `apply` — `run_retention_purge(200, false)` (service_role; partie z limitem 200 na
  kategorię, profile 50, `FOR UPDATE SKIP LOCKED`, liczniki na kategorię). Licznik
  `fullBatches` = kategorie, które wyczerpały partię; worker woła kolejne partie (każda
  w osobnej transakcji), aż zaległość zniknie, najwyżej 10 w jednym przebiegu (RET-08:
  601 rekordów = 200/200/200/1).
- `dry-run` — `run_retention_purge(200, true)`: ta sama partia w podtransakcji wycofanej
  na końcu — liczniki bez zmian danych, bez ostrzeżeń i e-maili (`dryRun: 1`).
- `off` (domyślnie) — baza nie jest wołana; odpowiedź `retention: { mode: 'off', batches: 0 }`.

Potem zawsze `processStorageDeletions` (`src/lib/storage-deletion.ts`). Odpowiedź zawiera
same liczniki (`retention`, `storageDeletions`). Błąd RPC = 503. Nieudane usunięcie obiektu
nie jest błędem przebiegu — wiersz kolejki wraca z backoffem (1 min · 2^n, maks. 1 doba);
po 20 próbach wiersz trafia do dead-letter (sekcja 3).

**Warunek operacyjny:** zadanie działa dopiero z usługą cron wywołującą
`/api/maintenance` (#13) i skonfigurowanym backendem. Sam kod i testy nie dowodzą
wykonania na produkcji.

## 3. Kolejka usuwania obiektów storage

`storage_deletion_queue (bucket, path)` wypełnia trigger `AFTER DELETE` na `files` —
każda ścieżka usunięcia (akcja kandydata, usunięcie konta, retencja, ponowne usunięcie
po restore) zostawia zadanie usunięcia obiektu. Worker: `claim_storage_deletions`
(dzierżawa 5 min) → usunięcie obiektu (prywatny bucket Railway z #26, gdy skonfigurowany;
inaczej Supabase Storage) → `complete_storage_deletion`. Brak obiektu =
sukces. Ścieżka, która znów ma wiersz `files`, wypada z kolejki bez usuwania.

**Dead-letter (RET-04, 0129).** 20. nieudana próba (albo porzucona dzierżawa po niej)
ustawia `dead_lettered_at`: wiersz nie jest już pobierany, ale zostaje i podnosi alarm —
`ops_metrics().storageDeletion` (`pending`, `oldestPendingAgeSeconds`, `deadLetters`),
czujki `storage_deletion_dead_letter` (każdy wiersz) i `storage_deletion_age` (obiekt czeka
> 24 h; cel 72 h) w `/api/health/ops`. Po usunięciu przyczyny:
`requeue_storage_dead_letters(ids | null)` (service_role, audyt `storage.dead_letters_requeued`
z samą liczbą) zeruje licznik prób.

### 3a. GC bucketu CV (#17, migracja 0117)

`/api/maintenance` przed workerem kolejki woła `runStorageGc` (`src/lib/storage-gc.ts`),
gdy prywatny bucket Railway jest skonfigurowany. Przebieg porównuje listę bucketu
(`list` w `railway-bucket.ts`, strony po 500 kluczy, najwyżej 20 stron na wywołanie)
z wierszami `files` (`bucket = 'candidate-files'`); kursor i liczniki w `storage_gc_sweeps`.

- **Obiekt bez wiersza** `files` (także miękko usuniętego), starszy niż 24 h (upload w toku) →
  `storage_deletion_queue`, usuwa go worker z sekcji 3. Obiekt bez daty modyfikacji i klucze
  spoza formatu CV nie są ruszane (`foreignObjects`).
- **Wiersz bez obiektu** (starszy niż 24 h) → tylko licznik `missingObjects`. Wiersz może
  wskazywać obiekt w starym storage sprzed migracji — decyzja o nim należy do człowieka.
- **Tryb:** domyślnie dry-run (same liczniki). Kolejkowanie wymaga `STORAGE_GC_MODE=delete`
  — produkcyjne kasowanie danych wymaga osobnego zatwierdzenia właściciela (#17).
  Zmiana trybu w trakcie przebiegu zaczyna go od początku.
- **Rytm:** nowy przebieg najwcześniej 23 h po poprzednim (dziennie przy cronie co godzinę);
  przebieg niedokończony (limit stron, awaria) jest kontynuowany od kursora. Dzierżawa 10 min
  chroni przed dwoma równoległymi przebiegami (`busy`); retry zatwierdzonej strony = `STALE_STATE`.
- **Prywatność:** odpowiedź i logi zawierają tylko liczniki; kursor (klucz z UUID właściciela)
  jest czyszczony po zakończeniu przebiegu, historia liczników — 90 dni.
- **Błąd listy bucketu** → 503 zadania `storageGc` (Sentry: sam kod), kolejka usuwania i tak
  jest przetwarzana.

Dowód: `tests/integration/storage-gc.test.ts` (PG16: kolejka, karencja, partie, rytm, dzierżawa,
uprawnienia, kontrola ujemna naiwnego kolejkowania), `tests/unit/storage-gc.test.ts`,
`tests/unit/railway-bucket.test.ts` (`list`).

## 4. Prawo dostępu — eksport JSON

UI: `/candidate/ustawienia` → „Pobierz moje dane (JSON)” → `POST /api/account/export`
(`Origin` tej witryny, cookies `SameSite=Lax`, `Cache-Control: private, no-store`,
treść nie jest logowana) → RPC `export_my_data()` pod sesją kandydata.

Zakres (`format: pracujbe-export/1`): konto (e-mail, data), profil, profil kandydata,
umiejętności/języki/certyfikaty, pliki (nazwa, typ, rozmiar, daty — bez klucza obiektu;
sam plik CV pobiera się z profilu), aplikacje z historią statusów i odpowiedziami
screeningowymi, propozycje z historią, **zapisane** wyniki `matches` (bez liczenia nowych),
rozmowy (treść obu stron, strona oznaczona `fromMe`, bez tożsamości rekrutera), zapisane
oferty i wyszukiwania, blokady firm (nazwa firmy), preferencje i powiadomienia, zgody, dowody zgód e-mail
(`email_consent_events`) i akceptacje dokumentów, e-maile (szablon, status, daty — bez treści), zgłoszenia bez konta
przejęte przez to konto, historia wniosków.

Pomijane: identyfikatory innych osób (rekruter, inny kandydat), klucze idempotencji,
klucze obiektów storage. Ograniczenie z art. 15(4) RODO wobec innych osób rozstrzyga się
indywidualnie — eksport automatyczny pomija tylko identyfikatory, nie treść rozmowy.
Limit: 10 eksportów na dobę (`RATE_LIMITED`). Każdy eksport = wiersz
`data_rights_requests` (`kind='access'`) i `data.exported` w `audit_logs`.

Eksport dotyczy tylko roli `candidate`; pracodawca i admin dostają `PERMISSION_DENIED`.

## 5. Usunięcie konta

UI: „Usuń konto…” → wpisanie adresu e-mail konta → `deleteMyAccountAction` →
RPC `request_account_erasure(email)`: rola `candidate`, aktywny profil, adres równy
adresowi konta (bez rozróżniania wielkości liter). W **jednej transakcji**
`erase_candidate_subject`:

1. usuwa powiadomienia i e-maile (także firm) o aplikacjach, propozycjach i rozmowach
   kandydata oraz e-maile do niego,
2. usuwa rozmowy procesu (z wiadomościami obu stron) i zgłoszenia bez konta
   powiązane z kontem lub jego aplikacjami,
3. usuwa wiersze `files` (obiekty → kolejka storage),
4. zeruje IP/user-agent w `audit_logs` wpisanych przez tę osobę, usuwa weryfikacje
   Better Auth dla adresu,
5. usuwa `auth.users` → kaskada FK: profil, profil kandydata i relacje, aplikacje z
   historią i odpowiedziami, propozycje, dopasowania, zgody, zapisane oferty i
   wyszukiwania, blokady, sesje i konta logowania,
6. zapisuje tombstone i `account.erased` w `audit_logs`.

Dostęp online jest odcięty w tej samej transakcji (nie ma profilu ani sesji). Zostają
(z FK → `null`): sprawy DSA złożone przez kandydata (obowiązek rozpatrzenia), wpisy
audytu bez IP/UA, aktywna blokada adresu w `email_suppressions` (po odbiciu/skardze).
Kopie zrobione przez pracodawcę poza serwisem nie są objęte.

Poprawki w 0105 wymagane przez usunięcie: `report_events_append_only` i `reports_guard`
przepuszczają wyłącznie odwołanie FK → `null` (wcześniej usunięcie autora zgłoszenia
DSA się wywracało; kontrole ujemne DR486-5/5b).

## 6. Rejestr usunięć i odtworzenie kopii

`erasure_tombstones(subject_id, channel, erased_at, reapplied_at)` — tylko UUID.
`apply_erasure_tombstones(uuid[])` (service_role) usuwa ponownie osoby obecne w
odtworzonej bazie. Procedura: [railway/BACKUP_RESTORE.md](railway/BACKUP_RESTORE.md)
(„Usunięcia po dacie kopii”), skrypty `scripts/db/export-erasure-tombstones.sh` i
`RESTORE_TOMBSTONES_FILE` w `restore-backup.sh`.

## 7. Dowody

- `supabase/tests/rls.sql` sekcja **DR486** — odmowy dla anon/obcego kandydata/
  pracodawcy, zakres eksportu i brak cudzych danych, limit, potwierdzenie, pełne
  usunięcie z nienaruszonymi danymi innych, kolejka (dzierżawa, backoff, sukces),
  retencja przed/po terminie i wyłączona kategoria, zmiana okresu tylko przez admina,
  ponowne usunięcie po restore. Kontrole ujemne: stare reguły DSA (5/5b), brak
  triggera kolejki (7f), dane z kopii bez rejestru (9).
- `npm run test:backup` — kopia → usunięcie → odtworzenie bez rejestru (dane wracają)
  i z rejestrem (usunięte, CV w kolejce), zły rejestr = odmowa.
- `supabase/tests/rls.sql` sekcja **RV574** (0129) — wartości, `closed_at` (kontrola ujemna
  bez triggera i starej reguły bez `hired`), `last_seen_at` z sesji, ostrzeżenie przed
  usunięciem (kontrola ujemna: bez ostrzeżenia nic nie znika), ślad gościa, dry-run bez
  zmian, 601 rekordów w partiach, dead-letter (kontrola ujemna: stary `complete`).
- Unit: `account-data`, `storage-deletion`, `guest-apply-maintenance` (flaga `RETENTION_MODE`,
  partie), `ops-sensors`, `retention-warning-email`, `job-expiry`.
- E2E (demo): `candidate-account-data.spec.ts`.

## 8. Otwarte

- Włączenie harmonogramu (`RETENTION_MODE`) — właściciel, po akceptacji testów RET-01…RET-13
  i danych operatora; najpierw `dry-run` na produkcji i przegląd liczników.
- Rejestr usunięć: minimum 400 dni i wartość 30 dni dopiero po RET-09/RET-10 (inwentarz kopii
  ≤ 14 dni kalendarzowych, test odtworzenia z replay rejestru i wycofań zgód).
- Brak zadań: dowody zgód 1095 dni, audyt 365 dni, `auth.email_outbox`, e-maile 30/90 dni,
  zaproszenia do zespołu, przegląd starych otwartych aplikacji (180 dni), rozmowy niezależne
  od aplikacji; `scripts/db/backup.sh` liczy kopie, nie dni.
- Konto pracodawcy bez aktywności (dziś tylko kandydat).
- E-mail o zmianie statusu dla gościa (#546) korzysta ze zgłoszenia `confirmed`; po 30 dniach
  (`confirmed_guest_request`) zgłoszenie znika — język gościa trzeba przenieść na aplikację.
- Informacja dla kandydatów (#61) — projekt w `legal-drafts/`.
- Harmonogram `/api/maintenance` i eksportu rejestru usunięć (infrastruktura, #13).
- Sprostowanie: edycja profilu istnieje; brak formularza wniosku o sprostowanie danych
  pochodnych (`matches`) i o ograniczenie/sprzeciw — dziś kanał kontaktu (#61).
- Eksport i usunięcie konta pracodawcy (firmy, członkostwa, ostatni owner) — osobny
  przepływ.
- Potwierdzenie usunięcia linkiem e-mail (dziś: sesja + wpisany adres) i powiadomienie
  firmy o wycofaniu danych kandydata.
- Panele i akcje nadal na kliencie Supabase; po #24/#25 te same RPC pod
  `withUserTransaction`.
