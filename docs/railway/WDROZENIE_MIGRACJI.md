# Wdrożenie migracji na produkcyjny PostgreSQL Railway (#23)

Runbook dla operatora. Railway **nie** uruchamia migracji automatycznie, a usługa
`pracujbe` nie ma (i nie może mieć) poświadczeń migratora. Każdy krok zapisu na
produkcji wymaga decyzji właściciela i odbywa się z maszyny operatora.

Stan na 23.09.2026: usługa `PostgreSQL 18` (projekt `captivating-vision`) działa, ale
nie wiadomo, czy migracje zostały nałożone; usługa `pracujbe` nie ma zmiennych bazy
(`DATABASE_APP_URL` itd.), więc aplikacja działa w trybie demo.

## Zasady

- Sekrety tylko w zmiennych środowiskowych sesji operatora — nigdy w argumentach,
  plikach repozytorium, issue, PR ani logach CI.
- `MIGRATION_DATABASE_URL` to login migratora (właściciel obiektów). Nie ustawiaj go
  w usłudze `pracujbe`.
- Najpierw odczyt, potem próba, na końcu zapis. Każdy krok ma jednoznaczny kod wyjścia.
- Produkcja nie jest seedowana (`supabase/seed.sql` odmawia pracy na bazie z danymi).

## Kroki

1. **Połączenie.** Z panelu Railway weź URL usługi `PostgreSQL 18` (publiczny TCP proxy
   albo `railway run` w sieci prywatnej) i ustaw w bieżącej powłoce jako
   `MIGRATION_DATABASE_URL`. Sprawdź, że wskazuje bazę produkcyjną `captivating-vision`.

2. **Stan (tylko odczyt).**
   ```bash
   MIGRATION_MODE=status npm run db:migrate:production
   ```
   Wynik: liczba zastosowanych i lista oczekujących plików. Niezgodna historia
   (zmieniony lub usunięty plik) kończy się kodem `1` — wtedy **stop** i analiza.

3. **Kopia przed zapisem.** Zrzut logiczny i dowód odtwarzalności do osobnej,
   pustej bazy `pracujbe_restore_<data>` (nie na produkcyjnym klastrze):
   ```bash
   RESTORE_SOURCE_URL="$MIGRATION_DATABASE_URL" RESTORE_TARGET_URL=… \
   RESTORE_KEEP_DUMP=./pracujbe-<data>.dump bash scripts/db/verify-restore.sh
   ```
   Na pustej bazie (brak `app_migrations.history`) krok pomija się — nie ma czego chronić.

4. **Próba (bez zapisu).**
   ```bash
   MIGRATION_MODE=dry-run npm run db:migrate:production
   ```
   Nakłada oczekujące migracje w transakcji i wycofuje je. Błąd = **stop**.
   Uwaga: próba bierze blokadę migratora i blokady DDL na czas transakcji —
   uruchamiaj poza szczytem ruchu.

5. **Zapis (decyzja właściciela).**
   ```bash
   MIGRATION_MODE=apply npm run db:migrate:production
   MIGRATION_MODE=status npm run db:migrate:production   # 0 oczekujących
   ```

6. **Loginy runtime.** Według `docs/railway/LOGINY_POSTGRESQL_ONE_OFF.md`:
   `preflight` → `provision` (najpierw dry-run) → `verify`.

7. **Konfiguracja aplikacji.** Zmienne `DATABASE_APP_URL` i pozostałe URL-e runtime
   ustawiamy w usłudze `pracujbe` dopiero wtedy, gdy wydanie aplikacji ich używa
   (#24 auth, #25 dane). Wcześniej ich ustawienie niczego nie włącza, a przedwczesne
   `APP_MODE=production` bez kompletnej konfiguracji daje 503 (fail-closed).

8. **Po wszystkim.** Rozważ wyłączenie publicznego TCP proxy bazy (dostęp operatora
   przez `railway run`/sieć prywatną) — decyzja właściciela.

## Rollback

- **Kod:** revert na `main`; schemat zostaje (migracje są addytywne względem kodu).
- **Schemat:** nowa migracja odwracająca (np. dla 0067/0068 opis w
  `MIGRACJE_POSTGRESQL.md`). Nie usuwaj plików ani wpisów historii — migrator odrzuci
  niezgodną historię.
- **Dane:** odtworzenie z archiwum z kroku 3 do nowej bazy i przełączenie URL-i —
  tylko przy utracie danych, decyzja właściciela.
- **Loginy:** `NOLOGIN` lub rotacja haseł (`LOGINY_POSTGRESQL_ONE_OFF.md`), bez `DROP`.

## Czego ten dokument nie robi

Nie konfiguruje pre-deploy w Railway. Automatyczne migracje przy wdrożeniu wymagają
osobnej usługi/zadania z loginem migratora oraz decyzji, jak zachować się przy błędzie
(wstrzymać wdrożenie) — do ustalenia po #24/#25.
