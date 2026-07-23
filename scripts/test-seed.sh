#!/usr/bin/env bash
# =============================================================================
# scripts/test-seed.sh — weryfikacja, że supabase/seed.sql ładuje się bez błędów.
#
# Świeża baza + seed-shim (auth.users z kolumnami Supabase) + wszystkie migracje + seed.
# Sprawdza brak błędów oraz minimalne liczności (10 firm / 50 ofert / 40 kandydatów).
# Zapobiega regresji typu „kolizja słowników -> FK -> cały seed odrzucony".
#
# Lokalnie:  sudo -u postgres bash scripts/test-seed.sh
# CI:        krok w jobie „rls" (usługa postgres:16), PGHOST/PGUSER/PGPASSWORD.
# =============================================================================
set -euo pipefail

DB="${SEED_TEST_DB:-pracujbe_seed_ci}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
[ -n "${PGHOST:-}" ] && psql_base+=(-h "$PGHOST")
[ -n "${PGPORT:-}" ] && psql_base+=(-p "$PGPORT")
[ -n "${PGUSER:-}" ] && psql_base+=(-U "$PGUSER")

echo ">> (re)tworzenie bazy: $DB"
"${psql_base[@]}" -d postgres -c "drop database if exists ${DB};" -c "create database ${DB};"

echo ">> seed-shim + migracje"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/seed-shim.sql" >/dev/null
for f in "$ROOT"/supabase/migrations/0*.sql; do
  "${psql_base[@]}" -d "$DB" -f "$f" >/dev/null
done

echo ">> seed (musi przejść bez błędu — ON_ERROR_STOP)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql" >/dev/null

echo ">> asercje liczności"
"${psql_base[@]}" -d "$DB" -v ON_ERROR_STOP=1 <<'SQL'
do $$
declare c int; j int; k int;
begin
  select count(*) into c from public.companies;
  select count(*) into j from public.jobs;
  select count(*) into k from public.candidate_profiles;
  if c < 10 then raise exception 'seed: za mało firm: %', c; end if;
  if j < 50 then raise exception 'seed: za mało ofert: %', j; end if;
  if k < 40 then raise exception 'seed: za mało kandydatów: %', k; end if;
  raise notice 'seed OK: % firm, % ofert, % kandydatów', c, j, k;
end $$;
SQL

"${psql_base[@]}" -d postgres -c "drop database if exists ${DB};" >/dev/null
echo "SEED load test: PASS"
