# Retencja danych i prawa kandydata — część techniczna (#486)

Opis tego, co system **robi**. Okresy przechowywania i treść informacji dla kandydatów
zatwierdza administrator danych; roboczy projekt dla prawnika jest w
[legal-drafts/retencja-i-prawa-kandydata.md](legal-drafts/retencja-i-prawa-kandydata.md)
(nieopublikowany). W interfejsie są tylko neutralne etykiety funkcji (`accountData.*`).

Migracja: `supabase/migrations/0104_data_retention_rights.sql` (numer tymczasowy —
ostateczny nadaje koordynator kolejki migracji).

## 1. Okresy retencji jako dane

`public.retention_policies` — klucz kategorii → `period` (`interval`, 1–3650 dni) albo
`null` (zadanie wyłączone). Zmiana tylko przez `admin_set_retention_policy(key, days)`
(`is_admin()`, wpis `retention.policy_changed` w `audit_logs`). Rejestru usunięć nie da
się skrócić poniżej 400 dni (musi przeżyć najstarszą kopię). Tabela jest niedostępna
dla ról klienta.

| Klucz | Domyślnie | Co robi zadanie po upływie okresu |
|---|---|---|
| `deleted_file` | 30 dni | usuwa wiersz `files` z `deleted_at`; obiekt storage trafia do kolejki |
| `deleted_profile` | 30 dni | pełne usunięcie kandydata z `profiles.deleted_at` (np. oznaczonego przez admina) |
| `closed_application` | wyłączone | usuwa aplikacje `rejected`/`withdrawn`/`offer_declined` (od `updated_at`) wraz z powiadomieniami i e-mailami o nich; ślad zgłoszenia gościa zostaje (FK → `null`) |
| `inactive_candidate_cv` | wyłączone | oznacza CV kandydata bez aktywności (`last_seen_at`) jako usunięte → potem `deleted_file` |
| `confirmed_guest_request` | do decyzji właściciela | **brak zadania** — tylko wartość konfigurowalna; cel i okres minimalnego śladu ustala właściciel |
| `data_rights_request_log` | wyłączone | usuwa ślad obsługi wniosku |
| `erasure_tombstone` | wyłączone (bez limitu) | usuwa wpis rejestru usunięć |

Zgłoszenia bez konta: tokeny i linki czyści `purge_guest_application_requests` (0095,
wygasłe linki potwierdzenia — osobna zmiana #522). Ta zmiana nie dotyka tokenów gościa i nie
usuwa automatycznie potwierdzonych zgłoszeń. Wyjątek: samoobsługowe usunięcie konta kasuje
zgłoszenia przejęte przez to konto lub powiązane z jego aplikacjami (wniosek osoby).

Domyślne wartości dotyczą wyłącznie danych już oznaczonych jako usunięte. Kategorie,
których okres wymaga decyzji administratora danych, startują wyłączone. `last_seen_at`
nie jest dziś aktualizowany przy logowaniu — przed włączeniem `inactive_candidate_cv`
trzeba to dołożyć (inaczej kryterium to data rejestracji).

## 2. Zadanie w `/api/maintenance`

Po dotychczasowych zadaniach: `run_retention_purge(200)` (service_role; partie z
limitem, `FOR UPDATE SKIP LOCKED`, liczniki na kategorię), potem
`processStorageDeletions` (`src/lib/storage-deletion.ts`). Odpowiedź zawiera same
liczniki (`retention`, `storageDeletions`). Błąd RPC = 503. Nieudane usunięcie obiektu
nie jest błędem przebiegu — wiersz kolejki wraca z backoffem (1 min · 2^n, maks. 1
doba, maks. 20 prób; `last_error` = kod, bez ścieżki).

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

Poprawki w 0104 wymagane przez usunięcie: `report_events_append_only` i `reports_guard`
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
- Unit: `account-data`, `storage-deletion`, `guest-apply-maintenance`, `job-expiry`.
- E2E (demo): `candidate-account-data.spec.ts`.

## 8. Otwarte

- Decyzje administratora danych: okresy kategorii wyłączonych, retencja kopii i
  rejestru, informacja dla kandydatów (#61) — projekt w `legal-drafts/`.
- Harmonogram `/api/maintenance` i eksportu rejestru usunięć (infrastruktura, #13).
- Sprostowanie: edycja profilu istnieje; brak formularza wniosku o sprostowanie danych
  pochodnych (`matches`) i o ograniczenie/sprzeciw — dziś kanał kontaktu (#61).
- Eksport i usunięcie konta pracodawcy (firmy, członkostwa, ostatni owner) — osobny
  przepływ.
- Potwierdzenie usunięcia linkiem e-mail (dziś: sesja + wpisany adres) i powiadomienie
  firmy o wycofaniu danych kandydata.
- Panele i akcje nadal na kliencie Supabase; po #24/#25 te same RPC pod
  `withUserTransaction`.
