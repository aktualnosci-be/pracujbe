# Kopia i odtworzenie PostgreSQL — dowód odtwarzalności (#47)

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

## Uruchomienie przez operatora

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

## Co jest sprawdzane w CI

Job `rls` uruchamia `scripts/db/test-restore.sh`: źródło z produkcyjnym bootstrapem,
wszystkimi migracjami i danymi, odtworzenie oraz kontrole ujemne (cel niepusty,
cel = źródło, niedozwolona nazwa, brak konfiguracji).

## Poza skryptem — do decyzji/infrastruktury

- Harmonogram: okresowe uruchamianie wymaga zadania cron (usługa Railway z
  klientem PG18 albo zewnętrzny runner) — koszt i miejsce do decyzji właściciela.
- Szyfrowanie i retencja archiwum (`RESTORE_KEEP_DUMP`) oraz miejsce przechowywania
  poza wolumenem bazy.
- Alarm przy błędzie kopii lub odtworzenia (#47).
- Wolumen Railway ma własne snapshoty; ten skrypt dowodzi odtwarzalności logicznej
  kopii, nie zastępuje polityki kopii wolumenu.

Rollback: skrypt i test są niezależne od runtime; usunięcie kroku CI i plików
nie zmienia bazy.
