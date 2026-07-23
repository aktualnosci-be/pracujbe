#!/usr/bin/env bash
# =============================================================================
# scripts/test-rls.sh — integracyjne testy RLS/triggerów na czystym PostgreSQL 16.
#
# Tworzy świeżą bazę, nakłada shim (supabase/tests/shim.sql) + WSZYSTKIE migracje
# w kolejności, a następnie uruchamia adwersaryjne asercje (supabase/tests/rls.sql).
# Każda nieudana asercja RAISE'uje wyjątek -> psql z ON_ERROR_STOP kończy się kodem !=0.
#
# Lokalnie (peer auth):   sudo -u postgres bash scripts/test-rls.sh
# Lub z hasłem/hostem:    PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres bash scripts/test-rls.sh
# W CI: usługa postgres:16 (patrz job „rls" w .github/workflows/ci.yml).
# =============================================================================
set -euo pipefail

DB="${RLS_TEST_DB:-pracujbe_rls_ci}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# psql bez pliku ~/.psqlrc (-X), zatrzymanie na pierwszym błędzie, cicho.
# Host/user/port dokładamy tylko gdy ustawione — pozwala to na lokalny peer auth
# (sudo -u postgres bash scripts/test-rls.sh, bez zmiennych) oraz na CI z hasłem
# (PGHOST=localhost PGUSER=postgres PGPASSWORD=postgres).
psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
[ -n "${PGHOST:-}" ] && psql_base+=(-h "$PGHOST")
[ -n "${PGPORT:-}" ] && psql_base+=(-p "$PGPORT")
[ -n "${PGUSER:-}" ] && psql_base+=(-U "$PGUSER")

echo ">> (re)tworzenie bazy testowej: $DB"
"${psql_base[@]}" -d postgres -c "drop database if exists ${DB};" -c "create database ${DB};"

echo ">> shim (role/auth/rozszerzenia)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/shim.sql" >/dev/null

echo ">> migracje"
for f in "$ROOT"/supabase/migrations/0*.sql; do
  "${psql_base[@]}" -d "$DB" -f "$f" >/dev/null
done

echo ">> asercje RLS/triggery"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/rls.sql"

echo ">> sprzątanie"
"${psql_base[@]}" -d postgres -c "drop database if exists ${DB};" >/dev/null

echo "RLS integration tests: PASS"
