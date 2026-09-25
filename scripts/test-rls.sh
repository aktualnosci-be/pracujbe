#!/usr/bin/env bash
# =============================================================================
# scripts/test-rls.sh — integracyjne testy RLS/triggerów na czystym PostgreSQL 16.
#
# Tworzy świeżą bazę i nakłada PRODUKCYJNY zestaw: bootstrap ról (database/bootstrap)
# oraz migracje domeny i auth (supabase/migrations + database/auth) w kolejności numerów —
# tak samo jak scripts/db/production-migrations.mjs. Następnie sprawdza model ról
# (supabase/tests/role-guard.sql, z kontrolami ujemnymi) i uruchamia adwersaryjne
# asercje (supabase/tests/rls.sql), które po każdym przełączeniu roli potwierdzają
# current_user, brak ścieżki do właściciela tabel/BYPASSRLS oraz row_security=on.
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

echo ">> bootstrap ról (produkcyjny, bez shimu Supabase)"
"${psql_base[@]}" -d "$DB" -1 -f "$ROOT/database/bootstrap/0001_roles_and_identity.sql" >/dev/null

echo ">> migracje domeny i auth (kolejność numerów jak w production-migrations.mjs)"
while IFS= read -r name; do
  "${psql_base[@]}" -d "$DB" -1 -f "$name" >/dev/null
done < <(for f in "$ROOT"/supabase/migrations/0*.sql "$ROOT"/database/auth/0*.sql; do
  printf '%s\t%s\n' "$(basename "$f")" "$f"
done | LC_ALL=C sort | cut -f2)

echo ">> model ról i kontrole ujemne"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/role-guard.sql"

echo ">> asercje RLS/triggery"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/rls.sql"

echo ">> rollback 0097 (ESCO, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/esco93-rollback.sql"

echo ">> rollback 0102 (materiały kampanii, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/campaign-job-rollback.sql"

echo ">> rollback 0112 (słownik miejscowości, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/locations-rollback.sql"

echo ">> sprzątanie"
"${psql_base[@]}" -d postgres -c "drop database if exists ${DB};" >/dev/null

echo "RLS integration tests: PASS"
