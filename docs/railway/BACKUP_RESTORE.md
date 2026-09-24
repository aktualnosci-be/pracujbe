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
nie wskazuj produkcyjnej bazy Railway jako celu. Polityki RLS odwołują się do ról
globalnych — skrypt tworzy brakujące role na celu jako `NOLOGIN` bez atrybutów.

### Co jest sprawdzane w CI

Job `rls` uruchamia `scripts/db/test-restore.sh`: źródło z produkcyjnym bootstrapem,
wszystkimi migracjami i danymi, odtworzenie oraz kontrole ujemne (cel niepusty,
cel = źródło, niedozwolona nazwa, brak konfiguracji).

## Kopia zaszyfrowana z retencją — `scripts/db/backup.sh`

Kopia do przechowywania, nie tylko dowód odtwarzalności:

1. `pg_dump -Fc` ze snapshotu transakcji REPEATABLE READ tylko do odczytu,
2. **pełny odczyt** archiwum: `pg_restore --list` oraz odtworzenie do `/dev/null`,
3. szyfrowanie `age` **kluczem publicznym**; zadanie kopii nie zna klucza prywatnego,
   a skrypt odrzuca plik odbiorców zawierający `AGE-SECRET-KEY`,
4. manifest `pracujbe-<UTC>.json` obok artefaktu `pracujbe-<UTC>.dump.age` zawiera
   rozmiar zrzutu i artefaktu, SHA-256 artefaktu, SHA-256 zapytań kontrolnych
   (historia migracji, tabele z RLS, liczba polityk, liczba wierszy każdej tabeli
   z tego samego snapshotu), liczbę tabel i migracji, ostatnią migrację i wersję
   serwera; manifest nie zawiera danych,
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
```

Kod `0` = kopia zapisana i odczytana, `1` = błąd kopii, `2` = zła konfiguracja.
Niezerowy kod to nieudane wykonanie crona Railway, czyli sygnał alarmu. Niezaszyfrowany zrzut
istnieje tylko w katalogu roboczym 0700 do chwili zaszyfrowania i jest usuwany także po błędzie.

Klucze: `age-keygen -o pracujbe-backup.key` (klucz prywatny przechowuj POZA Railway),
`age-keygen -y pracujbe-backup.key > recipients.txt` (klucz publiczny dla zadania kopii).
Rotacja: dopisz nowy klucz publiczny do `recipients.txt` (kopie da się otworzyć
każdym z kluczy) i usuń stary po wygaśnięciu retencji.

## Odtworzenie artefaktu — `scripts/db/restore-backup.sh`

```text
RESTORE_ARCHIVE             # ścieżka pracujbe-<UTC>.dump.age (manifest obok)
RESTORE_AGE_IDENTITY_FILE   # klucz prywatny age
RESTORE_TARGET_URL          # pusta baza pracujbe_restore_* na OSOBNYM klastrze
RESTORE_TOMBSTONES_FILE     # (opcjonalnie, #486) rejestr usunięć nowszy niż kopia
```

Kolejne kroki: zgodność SHA-256 artefaktu z manifestem, odszyfrowanie, pełny
odczyt, utworzenie brakujących ról polityk jako `NOLOGIN`, `pg_restore
--single-transaction --exit-on-error` i porównanie SHA-256 zapytań kontrolnych
z manifestem. Kody wyjścia jak wyżej. Podmieniony artefakt, zły klucz, zmieniony
manifest, niepusty cel i nazwa spoza `pracujbe_restore_*` kończą się błędem.

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
artefakcie, odtwarza najnowszą kopię i wykonuje 8 kontroli ujemnych. Scenariusz #486:
kandydat usunięty po kopii wraca przy odtworzeniu bez rejestru (kontrola ujemna), z
rejestrem jest usuwany ponownie, a zły rejestr kończy się odmową bez odtworzenia. Wymaga `age`
i `age-keygen`, nie łączy się z internetem. Workflow CI nie uruchamia go
automatycznie. Gotowy krok dla właściciela jest w [OPERATIONS.md](OPERATIONS.md) §5.

## Poza skryptami — do decyzji/infrastruktury

- Harmonogram kopii (raz na dobę) i okresowego odtworzenia (raz w tygodniu): usługi
  cron Railway z klientem PG18 i `age` albo zewnętrzny runner. Koszt i miejsce
  wybiera właściciel.
- Miejsce przechowywania artefaktów poza wolumenem bazy (bucket, druga lokalizacja).
- Usługa heartbeat dla `BACKUP_HEARTBEAT_URL` (alarm przy braku kopii).
- Wolumen Railway ma własne snapshoty. Te skrypty dowodzą odtwarzalności logicznej
  kopii i nie zastępują polityki kopii wolumenu.

Rollback: skrypty i testy są niezależne od runtime. Usunięcie plików nie zmienia
bazy. Rozróżnienie rollbacku kodu, schematu i danych: [OPERATIONS.md](OPERATIONS.md) §4.
