#!/usr/bin/env bash
# =============================================================================
# scripts/db/test-restore.sh — test verify-restore.sh na jednorazowym PostgreSQL (#47).
#
# Tworzy bazę źródłową z produkcyjnym bootstrapem i migracjami, dodaje dane
# (użytkownik, profil, firma), sprawdza odtworzenie do pracujbe_restore_ci oraz
# kontrole ujemne: niepusty cel, ta sama baza i niedozwolona nazwa celu.
# Użycie jak test-rls.sh (PGHOST/PGUSER/PGPASSWORD albo peer auth jako postgres).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DB=pracujbe_restore_source_ci
DST_DB=pracujbe_restore_ci

psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
[ -n "${PGHOST:-}" ] && psql_base+=(-h "$PGHOST")
[ -n "${PGPORT:-}" ] && psql_base+=(-p "$PGPORT")
[ -n "${PGUSER:-}" ] && psql_base+=(-U "$PGUSER")

url() {
  local auth="${PGUSER:-postgres}"
  [ -n "${PGPASSWORD:-}" ] && auth+=":${PGPASSWORD}"
  if [ -n "${PGHOST:-}" ]; then
    printf 'postgresql://%s@%s:%s/%s' "$auth" "$PGHOST" "${PGPORT:-5432}" "$1"
  else
    printf 'postgresql:///%s' "$1"
  fi
}

recreate() { "${psql_base[@]}" -d postgres -c "drop database if exists $1;" -c "create database $1;"; }
cleanup() { for db in "$SRC_DB" "$DST_DB"; do "${psql_base[@]}" -d postgres -c "drop database if exists $db;" >/dev/null; done; }
trap cleanup EXIT

echo '>> źródło: produkcyjny bootstrap + migracje + dane'
recreate "$SRC_DB"
"${psql_base[@]}" -d "$SRC_DB" -1 -f "$ROOT/database/bootstrap/0001_roles_and_identity.sql" >/dev/null
while IFS= read -r file; do
  "${psql_base[@]}" -d "$SRC_DB" -1 -f "$file" >/dev/null
done < <(for f in "$ROOT"/supabase/migrations/0*.sql "$ROOT"/database/auth/0*.sql; do
  printf '%s\t%s\n' "$(basename "$f")" "$f"
done | LC_ALL=C sort | cut -f2)
# Historia migracji jak po migratorze (verify-restore porównuje nazwy i sumy).
"${psql_base[@]}" -d "$SRC_DB" <<'SQL' >/dev/null
create schema if not exists app_migrations;
create table if not exists app_migrations.history(
  name text primary key, checksum text not null, applied_at timestamptz not null default now());
insert into app_migrations.history(name, checksum) values ('0000_test.sql', repeat('a', 64));
insert into auth.users(id, email, name, raw_user_meta_data) values
  ('0f000000-0000-4000-8000-000000000001', 'restore@test.invalid', 'Restore', '{"role":"employer"}');
insert into public.companies(id, name, status) values
  ('0f000000-0000-4000-8000-0000000000c1', 'Firma kopii', 'verified');
SQL

echo '>> odtworzenie do izolowanej bazy'
recreate "$DST_DB"
out="$(RESTORE_SOURCE_URL="$(url "$SRC_DB")" RESTORE_TARGET_URL="$(url "$DST_DB")" \
  bash "$ROOT/scripts/db/verify-restore.sh")"
printf '%s\n' "$out"
grep -q '^RESTORE: PASS' <<<"$out" || { echo 'Brak PASS'; exit 1; }
[ "$("${psql_base[@]}" -At -d "$DST_DB" -c "select name from public.companies")" = 'Firma kopii' ] \
  || { echo 'Dane nie zostały odtworzone'; exit 1; }

expect_code() {
  local expected="$1" label="$2" code=0
  shift 2
  env "$@" bash "$ROOT/scripts/db/verify-restore.sh" >/dev/null 2>&1 || code=$?
  [ "$code" = "$expected" ] || { echo "Kontrola ujemna '$label': kod $code zamiast $expected"; exit 1; }
  echo ">> kontrola ujemna OK: $label"
}

expect_code 2 'cel niepusty' RESTORE_SOURCE_URL="$(url "$SRC_DB")" RESTORE_TARGET_URL="$(url "$DST_DB")"
expect_code 2 'cel = źródło' RESTORE_SOURCE_URL="$(url "$DST_DB")" RESTORE_TARGET_URL="$(url "$DST_DB")"
expect_code 2 'niedozwolona nazwa celu' RESTORE_SOURCE_URL="$(url "$SRC_DB")" RESTORE_TARGET_URL="$(url postgres)"
expect_code 2 'brak konfiguracji' RESTORE_SOURCE_URL= RESTORE_TARGET_URL=

echo 'Restore verification test: PASS'
