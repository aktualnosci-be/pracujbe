# Kopia i odtworzenie PostgreSQL (#47)

## Dowód odtwarzalności — `scripts/db/verify-restore.sh`

`scripts/db/verify-restore.sh` wykonuje zrzut `pg_dump -Fc` bazy źródłowej,
czyta całe archiwum (`pg_restore --list`), odtwarza je do **pustej, izolowanej**
bazy `pracujbe_restore_*` i porównuje:

- historię migracji (`app_migrations.history`: nazwy i SHA-256),
- listę tabel `public`/`auth`/`app_migrations`, tabele z włączonym RLS i liczbę polityk,
- liczbę wierszy w każdej tabeli.

Liczności źródła są czytane z tego samego snapshotu (`pg_export_snapshot`), z którego
powstał zrzut, więc kontrola jest poprawna również na działającej produkcji i nie
blokuje zapisów. Skrypt nigdy nie pisze do źródła i nie usuwa baz. Wejście wyłącznie
ze zmiennych środowiskowych; URL-e i hasła nie są wypisywane.

### Uruchomienie przez operatora

Wymagany klient PostgreSQL w wersji co najmniej równej serwerowi (Railway: 18).

```text
RESTORE_SOURCE_URL   # login tylko do odczytu albo migrator (nie login runtime web)
RESTORE_TARGET_URL   # pusta baza pracujbe_restore_<data> na OSOBNYM klastrze
RESTORE_KEEP_DUMP    # opcjonalnie: ścieżka zachowania archiwum
```

```bash
bash scripts/db/verify-restore.sh
```

Kod `0` = kopia odtworzona i zgodna, `1` = niezgodność lub błąd, `2` = zła konfiguracja
(np. cel niepusty, cel = źródło, nazwa celu spoza `pracujbe_restore_*`).

Cel musi być osobną, nietrwałą bazą: lokalny kontener albo tymczasowa usługa. Nigdy
nie wskazuj produkcyjnej bazy Railway jako celu.

### Uprawnienia i role (OPS14-01)

Zrzut i odtworzenie zachowują uprawnienia (GRANT/REVOKE, także odebrane `EXECUTE`
dla `PUBLIC`), ale nie właścicieli (`--no-owner`): obiekty należą do loginu, który
odtwarza — uruchamiaj jako migrator `postgres`, jak bootstrap. Role są globalne dla
klastra i nie ma ich w kopii. Skrypt zbiera nazwy ról z polityk i GRANT/REVOKE archiwum
i tworzy brakujące wg kontraktu `database/bootstrap` (`scripts/db/lib/restore-roles.sh`):
`NOLOGIN` bez atrybutów, `BYPASSRLS` tylko `service_role`, `pracujbe_app` członkiem
`anon` i `authenticated`. Istniejących ról nie zmienia. Loginy runtime i hasła nadaje
potem operator (`scripts/db/runtime-logins.mjs`).

Kontrola porównuje odcisk uprawnień źródła i celu: wpisy ACL schematów, tabel, kolumn,
sekwencji, funkcji, typów i uprawnień domyślnych (bez wpisów właściciela), a także
atrybuty i członkostwa ról, którym nadano uprawnienia. Odtworzenie bez uprawnień albo
rola runtime z innymi atrybutami na celu (np. `LOGIN`) kończy się kodem `1`.

### Co jest sprawdzane w CI

Job `rls` uruchamia `scripts/db/test-restore.sh`: źródło z produkcyjnym bootstrapem,
wszystkimi migracjami i danymi, odtworzenie oraz kontrole ujemne (cel niepusty,
cel = źródło, niedozwolona nazwa, brak konfiguracji) i sprawdzenie, że funkcja tylko
dla `service_role` nie ma `EXECUTE` dla `PUBLIC`/`anon` po odtworzeniu.

## Kopia zaszyfrowana z retencją — `scripts/db/backup.sh`

Kopia do przechowywania, nie tylko dowód odtwarzalności:

1. `pg_dump -Fc` ze snapshotu transakcji REPEATABLE READ tylko do odczytu,
2. **pełny odczyt** archiwum: `pg_restore --list` oraz odtworzenie do `/dev/null`,
3. szyfrowanie `age` **kluczem publicznym**; zadanie kopii nie zna klucza prywatnego,
   a skrypt odrzuca plik odbiorców zawierający `AGE-SECRET-KEY`,
4. manifest `pracujbe-<UTC>.json` obok artefaktu `pracujbe-<UTC>.dump.age` zawiera
   rozmiar zrzutu i artefaktu, SHA-256 artefaktu, SHA-256 zapytań kontrolnych
   (historia migracji, tabele z RLS, liczba polityk, liczba wierszy każdej tabeli
   z tego samego snapshotu), SHA-256 odcisku uprawnień (`aclSha256`, `aclItems`),
   liczbę tabel i migracji, ostatnią migrację i wersję serwera; manifest nie zawiera
   danych. Format `pracujbe-backup/2`; kopie formatu 1 (bez uprawnień) są odrzucane
   przy odtworzeniu — po wdrożeniu zrób nową kopię,
5. retencja: zostaje `BACKUP_RETENTION` najnowszych kopii; usuwane są wyłącznie
   pliki o dokładnym wzorcu nazwy. Artefakt i manifest mają prawa 0600, katalog 0700,
6. opcjonalny `BACKUP_HEARTBEAT_URL`: po sukcesie `GET URL`, po błędzie `GET URL/fail`.
   Brak pingu w oknie usługi (dead-man’s switch) = alarm. Kolejny udany ping to recovery.

```text
BACKUP_SOURCE_URL           # login tylko do odczytu albo migrator (nie login WWW)
BACKUP_DIR                  # katalog artefaktów (wolumen/bucket POZA wolumenem bazy)
BACKUP_AGE_RECIPIENTS_FILE  # klucz(e) publiczne age1…
BACKUP_RETENTION            # domyślnie 14 (1–365)
BACKUP_WORK_DIR             # opcjonalnie: dysk na chwilowy zrzut (usuwany zawsze)
BACKUP_HEARTBEAT_URL        # opcjonalnie
BACKUP_AGE_RECIPIENTS       # zamiast pliku: klucze publiczne age w zmiennej (usługa Railway)
BACKUP_S3_*                 # #569: kopia w buckecie Cloudflare R2 (sekcja niżej)
```

Kod `0` = kopia zapisana i odczytana, `1` = błąd kopii, `2` = zła konfiguracja.
Niezerowy kod to nieudane wykonanie crona Railway, czyli sygnał alarmu. Niezaszyfrowany zrzut
istnieje tylko w katalogu roboczym 0700 do chwili zaszyfrowania i jest usuwany także po błędzie.

Klucze: `age-keygen -o pracujbe-backup.key` (klucz prywatny przechowuj POZA Railway),
`age-keygen -y pracujbe-backup.key > recipients.txt` (klucz publiczny dla zadania kopii).
Rotacja: dopisz nowy klucz publiczny do `recipients.txt` (kopie da się otworzyć
każdym z kluczy) i usuń stary po wygaśnięciu retencji.

## Kopia poza Railwayem — Cloudflare R2 (#569)

Kopia trafia do **osobnego, prywatnego bucketu Cloudflare R2** przez API S3 (endpoint R2,
region `auto`, styl ścieżki). Pliki CV zostają w buckecie Railway (#26, zmienne `AWS_*`) —
`scripts/db/lib/backup-s3.mjs` odmawia (kod 2), gdy `BACKUP_S3_*` wskazuje ten sam bucket
albo klucz co `AWS_*`.

`backup.sh` sprawdza konfigurację R2 **przed** zrzutem (zła/niepełna = kod 2, nic nie
powstaje). Po zapisie lokalnym wysyła artefakt, potem manifest (kopia z manifestem jest
kompletna), sprawdza rozmiar obiektów i stosuje retencję w buckecie: zostaje
`BACKUP_RETENTION` najnowszych KOMPLETNYCH kopii (artefakt + manifest; #1228 — kopie bez
manifestu nie zajmują miejsca w limicie), a przy `BACKUP_S3_MAX_AGE_DAYS` także usuwane są
kopie starsze niż N dni; najnowsza kompletna kopia zostaje zawsze. Kopie niekompletne
(artefakt bez manifestu po nieudanej wysyłce albo sam manifest) są sprzątane osobno, gdy są
starsze niż 24 h (młodsza może być w trakcie wysyłki). Usuwane są wyłącznie obiekty o wzorcu
nazwy kopii. Błąd wysyłki lub retencji = kod 1 i heartbeat `/fail`.

Klucze (dwa osobne tokeny API R2, zakres: tylko ten bucket):

| Zmienna | Gdzie | Uprawnienie |
|---|---|---|
| `BACKUP_S3_ENDPOINT` | zadanie kopii, usługa web, odtworzenie | `https://<konto>.r2.cloudflarestorage.com` |
| `BACKUP_S3_BUCKET`, `BACKUP_S3_PREFIX` (opcjonalnie), `BACKUP_S3_REGION` (domyślnie `auto`) | jw. | — |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | **tylko** zadanie kopii | Object Read & Write |
| `BACKUP_S3_READ_ACCESS_KEY_ID`, `BACKUP_S3_READ_SECRET_ACCESS_KEY` | usługa web (czujka), odtworzenie | Object Read only |
| `BACKUP_S3_MAX_AGE_DAYS` | zadanie kopii (opcjonalnie) | — |

Klucz zapisu w usłudze web = alarm `backup_misconfigured` w `/api/health/ops`.

Odtworzenie z R2: `RESTORE_S3_OBJECT=latest` (albo nazwa `pracujbe-<UTC>.dump.age`) zamiast
`RESTORE_ARCHIVE`, z kluczem **odczytu** — skrypt pobiera artefakt i manifest do katalogu
chwilowego i dalej działa jak dla pliku lokalnego (SHA-256, odszyfrowanie, kontrole).
Oba naraz albo klucz zapisu zamiast odczytu = kod 2.

Test: `npm run test:backup` dokłada scenariusz R2 na atrapie S3
(`tests/helpers/fake-s3-server.mjs`, klucz odczytu nie może PUT/DELETE): trzy kopie z wysyłką
przy retencji 2 w buckecie, najnowsza w R2 = lokalna, odtworzenie z R2 i kontrole ujemne
(klucz zapisu do odtworzenia, oba źródła naraz, klucz odczytu do wysyłki — bucket bez zmian,
niepełna konfiguracja, endpoint http). Logika w Vitest: `backup-r2.test.ts`,
`backup-r2-image.test.ts`, `ops-health-route.test.ts`.

## Obraz usługi kopii — build, smoke, SBOM i skan (#751)

Usługa `backup` w Railway buduje `docker/backup/Dockerfile`. Ten sam plik buduje od zera
(`--pull --no-cache`) job **„Backup image (build + scan)”** w OSOBNYM workflow
`.github/workflows/backup-image.yml` — błąd repozytorium APT, obrazu bazowego albo zależności
wychodzi w CI, a nie dopiero w Railway. Workflow nie jest częścią `ci.yml` (decyzja właściciela
2026-10-02), więc wynik skanu nie blokuje wdrożenia aplikacji web (`Wait for CI`). Uruchamia
się przy zmianie `docker/backup/**`, `scripts/db/**`, skryptów bramki, `package.json` albo
samego workflowu (push na `main` i PR), ręcznie (`workflow_dispatch`) i co tydzień (poniedziałek
04:23 UTC — nowe podatności w niezmienionym obrazie). Czerwony przebieg = nie włączaj ani nie
aktualizuj usługi `backup` w Railway, dopóki bramka nie będzie zielona.

- **Obraz bazowy przypięty do digestu** (`node:22-bookworm-slim@sha256:…`). Sam tag bez
  digestu odrzuca strażnik (`scripts/check-ci-workflows.mjs`, `backup-r2-image.test.ts`).
  Aktualizacja = PR Dependabota (`.github/dependabot.yml`, ekosystem `docker`, katalog
  `/docker/backup`) — diff pokazuje stary i nowy digest, a job CI buduje i skanuje nowy obraz
  przed scaleniem. Ręcznie: `docker buildx imagetools inspect node:22-bookworm-slim`
  (pole `Digest` indeksu) i zmiana jednej linii `FROM`.
- **Smoke** (`scripts/db/backup-image-smoke.sh <obraz>`): użytkownik `node` (uid ≠ 0), node 22,
  `pg_dump`/`pg_restore`/`psql` 18, `age`, `@aws-sdk/client-s3` w wersji z `package.json`,
  brak `npm`/`npx`/`yarn` (usunięte z obrazu — niepotrzebne w czasie działania), start bez
  konfiguracji = kod 2 bez wypisania wartości zmiennych. Kontener bez sieci i bez sekretów.
- **SBOM i skan:** Trivy (obraz przypięty do wersji i digestu w `TRIVY_IMAGE` joba) zapisuje
  SBOM CycloneDX i raport JSON z listą pakietów (Debian + Node); oba są artefaktem
  `backup-image-sbom-<SHA>` (30 dni). Bramka `scripts/security/backup-image-scan.mjs`:
  - kod 0 — raport obejmuje pakiety Debiana i Node, SBOM zawiera `age`, `postgresql-client-18`
    i `@aws-sdk/client-s3`, brak podatności blokujących;
  - kod 1 — podatność **HIGH lub CRITICAL z dostępną poprawką** bez ważnego wyjątku;
  - kod 2 — raport/SBOM pusty, niepełny lub nieczytelny albo zły plik wyjątków; awaria samego
    skanera kończy krok skanu kodem 2. Żadna awaria nie wygląda jak „brak podatności”.
  HIGH/CRITICAL bez poprawki w dystrybucji są liczone w podsumowaniu joba, ale nie blokują.
- **Wyjątki:** `docker/backup/vulnerability-exceptions.json`, wpis
  `{ "id": "CVE-…", "package": "<pakiet>", "reason": "…", "expires": "YYYY-MM-DD" }`;
  termin najwyżej 90 dni od dnia przebiegu, po terminie podatność znów blokuje.
- **Pochodzenie przed wdrożeniem:** podsumowanie joba na `main` podaje SHA commita, pełną
  linię `FROM` z digestem i ID zbudowanego obrazu. Przed włączeniem albo zmianą usługi
  `backup` w Railway zanotuj w `docs/railway/STATUS.md`: SHA wdrożenia, digest obrazu
  bazowego z `docker/backup/Dockerfile` tego SHA i link do zielonego przebiegu joba.
  Railway buduje obraz sam, więc ID obrazu z CI i z Railway mogą się różnić (pakiety APT
  pobierane w chwili builda); wspólne i sprawdzone są: commit, digest bazowy i zestaw kroków.

## Odtworzenie artefaktu — `scripts/db/restore-backup.sh`

```text
RESTORE_ARCHIVE             # ścieżka pracujbe-<UTC>.dump.age (manifest obok)
RESTORE_AGE_IDENTITY_FILE   # klucz prywatny age
RESTORE_TARGET_URL          # pusta baza pracujbe_restore_* na OSOBNYM klastrze
RESTORE_TOMBSTONES_FILE     # (opcjonalnie, #486) rejestr usunięć nowszy niż kopia
RESTORE_S3_OBJECT           # (#569) zamiast RESTORE_ARCHIVE: `latest` albo nazwa w R2 + BACKUP_S3_READ_*
RESTORE_KEEP_PORTAL_MODE    # (#1143) `1` = zachowaj tryb portalu z kopii (domyślnie wymuszany CLASSIFIEDS_ONLY)
```

Kolejne kroki: zgodność SHA-256 artefaktu z manifestem, odszyfrowanie, pełny
odczyt, utworzenie brakujących ról wg bootstrapu, `pg_restore --no-owner
--single-transaction --exit-on-error` (z uprawnieniami) i porównanie SHA-256 zapytań
kontrolnych oraz odcisku uprawnień z manifestem. Kody wyjścia jak wyżej. Podmieniony artefakt, zły klucz, zmieniony
manifest, niepusty cel i nazwa spoza `pracujbe_restore_*` kończą się błędem.

### Tryb portalu po odtworzeniu (#1143)

Po kontrolach zgodności z manifestem skrypt wymusza tryb ogłoszeniowy
(`admin_set_portal_legal_mode('CLASSIFIEDS_ONLY', …)` z wpisem audytu), jeśli kopia była
w trybie `RECRUITMENT` — przywrócona kopia nie włącza po cichu funkcji rekrutacyjnych.
Zachowanie trybu z kopii tylko jawnie: `RESTORE_KEEP_PORTAL_MODE=1` (decyzja właściciela).
Wynik w wierszu `RESTORE: tryb portalu: …`. Procedura trybu: [OPERATIONS.md](OPERATIONS.md) §6.

### Usunięcia po dacie kopii (#486)

Kopia sprzed usunięcia konta zawiera dane tej osoby. Dlatego odtworzenie, które ma
zastąpić bazę, zawsze idzie z rejestrem usunięć:

1. `TOMBSTONE_SOURCE_URL=<bieżąca baza, odczyt> TOMBSTONE_OUTPUT=<plik> bash
   scripts/db/export-erasure-tombstones.sh` — plik `pracujbe-erasure-tombstones/1`
   z samymi UUID z `erasure_tombstones` (prawa 0600). Gdy bieżąca baza jest
   niedostępna, użyj najnowszego pliku eksportowanego okresowo obok kopii.
2. `restore-backup.sh` z `RESTORE_TOMBSTONES_FILE=<plik>` — format sprawdzany przed
   odtworzeniem (zły plik = kod 2, cel pusty), po kontrolach manifestu
   `apply_erasure_tombstones` usuwa te osoby ponownie, a skrypt sprawdza, że w
   `profiles` i `auth.users` nie został żaden identyfikator z rejestru. Pliki CV tych
   osób trafiają do `storage_deletion_queue` odtworzonej bazy, więc worker w
   `/api/maintenance` usuwa także obiekty odtworzone z kopii bucketu.

Rejestr zawiera tylko osoby usunięte do chwili eksportu. Utrata bazy bez aktualnego
pliku oznacza utratę usunięć od ostatniego eksportu — dlatego eksport powinien iść
tym samym harmonogramem co kopia, do innego miejsca niż baza. Szczegóły i otwarte
decyzje: [DATA_RETENTION.md](../DATA_RETENTION.md).

Test obu skryptów: `sudo -u postgres npm run test:backup` (lokalny PG16) albo
`PGHOST=… PGUSER=… PGPASSWORD=… npm run test:backup`. Test wykonuje trzy kopie
przy retencji 2, sprawdza prawa plików, format `age` i brak plaintextu w
artefakcie, odtwarza najnowszą kopię i wykonuje kontrole ujemne. Scenariusz #486:
kandydat usunięty po kopii wraca przy odtworzeniu bez rejestru (kontrola ujemna), z
rejestrem jest usuwany ponownie, a zły rejestr kończy się odmową bez odtworzenia. OPS14-01:
odtworzona baza ma uprawnienia źródła, a kopia bez ACL (jak dawne `--no-acl`) i manifest
formatu 1 są odrzucane (kontrole ujemne). #1143: kopia z `RECRUITMENT` po odtworzeniu ma
`CLASSIFIEDS_ONLY` (z wpisem audytu), a tylko `RESTORE_KEEP_PORTAL_MODE=1` zachowuje tryb kopii. Z `BACKUP_TEST_FRESH_PGHOST`/`BACKUP_TEST_FRESH_PGPORT`
(drugi, pusty klaster bez ról runtime) test odtwarza też kopię tam: role powstają wg
bootstrapu, a rola `anon` z `LOGIN` na celu kończy się odmową. Wymaga `age`
i `age-keygen`, nie łączy się z internetem. Workflow CI nie uruchamia go
automatycznie. Gotowy krok dla właściciela jest w [OPERATIONS.md](OPERATIONS.md) §5.

## Poza skryptami — do decyzji/infrastruktury

- Harmonogram kopii (raz na dobę) i okresowego odtworzenia (raz w tygodniu): usługi
  cron Railway z klientem PG18 i `age` albo zewnętrzny runner. Koszt i miejsce
  wybiera właściciel.
- Bucket R2 (#569): utworzenie, **bez domeny publicznej i bez `r2.dev`**, dwa tokeny API
  (zapis / tylko odczyt, zakres: ten bucket), zmienne jak wyżej — kroki w OPERATIONS.md §5.
- Usługa heartbeat dla `BACKUP_HEARTBEAT_URL` (alarm przy braku kopii).
- Wolumen Railway ma własne snapshoty. Te skrypty dowodzą odtwarzalności logicznej
  kopii i nie zastępują polityki kopii wolumenu.

Rollback: skrypty i testy są niezależne od runtime. Usunięcie plików nie zmienia
bazy. Rozróżnienie rollbacku kodu, schematu i danych: [OPERATIONS.md](OPERATIONS.md) §4.
