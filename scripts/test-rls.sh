#!/usr/bin/env bash
# ======================================================================
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
# ======================================================================
set -euo pipefail

DB="${RLS_TEST_DB:-pracujbe_rls_ci}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# Lista migracji jak w produkcyjnym loaderze (każdy `NNNN_*.sql`, #1114): scripts/lib/migration-files.sh.
. "$ROOT/scripts/lib/migration-files.sh"
MIGRATIONS="$(migration_files "$ROOT/supabase/migrations" "$ROOT/database/auth")"

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
done <<< "$MIGRATIONS"

echo ">> model ról i kontrole ujemne"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/role-guard.sql"

echo ">> #1140 (0171): świeża baza = tryb ogłoszeniowy (CL1128-0)"
[ "$("${psql_base[@]}" -d "$DB" -At -c "select public.recruitment_enabled()")" = "f" ] \
  || { echo "CL1128-0 FAIL: świeża baza nie jest w trybie ogłoszeniowym" >&2; exit 1; }

echo ">> asercje RLS/triggery"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/rls.sql"

echo ">> rollback 0942 (wiadomości serwisowe a opt-out in-app, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/notification-inapp-service-rollback.sql"

echo ">> rollback 0194 (filtry listy ofert, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/job-filters-rollback.sql"

echo ">> rollback 0097 (ESCO, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/esco93-rollback.sql"

echo ">> rollback 0198 (opis firmy z zatwierdzaniem, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/company-description-rollback.sql"

echo ">> rollback 0102 (materiały kampanii, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/campaign-job-rollback.sql"

echo ">> rollback 0207 (eksport pracodawcy: odwołania i zgłoszenia, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/employer-export-0207-rollback.sql"
echo ">> rollback 0206 (indeksy usuwania konta i znaki sterujące w nazwach, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/db-perf-control-chars-rollback.sql"
echo ">> rollback 0205 (potwierdzenie kontaktu w języku odbiorcy, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/contact-recipient-locale-rollback.sql"
echo ">> rollback 0204 (tryb ogłoszeniowy: szablony odpowiedzi, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/classifieds-message-templates-rollback.sql"

echo ">> rollback 0192 (czujki poczty i requeue, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/email-ops-config-rollback.sql"

echo ">> rollback 0183 (części gmin w filtrach, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/city-sections-filters-rollback.sql"

echo ">> rollback 0208 (kursorowe RPC sitemapy ofert, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/sitemap-cursor-rollback.sql"

echo ">> rollback 0151 (części gmin, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/locations-sections-rollback.sql"

echo ">> rollback 0151 + 0112 (słownik miejscowości, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/locations-rollback.sql"

echo ">> rollback 0202 (reopen = nowa publikacja, zaproszenia usuwanego pracodawcy; w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/owner-decisions-0202-rollback.sql"

echo ">> rollback 0200 (kontekst zaufanej edycji oferty, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/job-edit-context-rollback.sql"

echo ">> rollback 0197 (retencja i DSA: termin, anonimizacja; w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/retention-dsa-0197-rollback.sql"

echo ">> rollback 0191 (kolejka automatycznego VIES, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/vies-auto-queue-rollback.sql"

echo ">> rollback 0189 (kontrakt soft-delete i limity plików CV, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/soft-delete-cv-quota-rollback.sql"

echo ">> rollback 0188 (DSA: dowód poinformowania i limity, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/dsa-informed-rollback.sql"
echo ">> rollback 0203 (tytuł oferty bez heurystyki zaślepki, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/job-title-completeness-rollback.sql"
echo ">> rollback 0186 (poczta: potwierdzony adres i język e-maili, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/email-verified-locale-rollback.sql"
echo ">> rollback 0185 (utwardzenie warstwy danych: oferty, firmy, pliki, sesje i tokeny; w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/rls-data-hardening-rollback.sql"
echo ">> rollback 0184 (token wersji szkicu oferty i czujka schematu, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/job-draft-cas-rollback.sql"
echo ">> rollback 0177 (schemat billingu, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/billing-schema-rollback.sql"

echo ">> rollback 0175 (konto i komunikacja w trybie ogłoszeniowym, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/classifieds-account-rollback.sql"

echo ">> rollback 0174 (tryb ogłoszeniowy: wiadomości i CV, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/classifieds-messaging-cv-rollback.sql"

echo ">> rollback 0190 (nazwy chronione w kolejce tłumaczeń, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/translation-protected-terms-rollback.sql"

echo ">> rollback 0190 + 0177 + 0176 + 0175 + 0174 + 0173 + 0171 (tryb portalu, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/portal-legal-mode-rollback.sql"

echo ">> rollback 0201 (język opisu firmy, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/company-description-locale-rollback.sql"
echo ">> rollback 0199 (cel zapisu oferty i relink aliasów, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/saved-jobs-alias-relink-rollback.sql"
echo ">> rollback 0195 (kolejka zdarzeń poczty, w transakcji cofanej)"
"${psql_base[@]}" -d "$DB" -f "$ROOT/supabase/tests/email-webhook-pending-rollback.sql"

echo ">> sprzątanie"
"${psql_base[@]}" -d postgres -c "drop database if exists ${DB};" >/dev/null

echo "RLS integration tests: PASS"
