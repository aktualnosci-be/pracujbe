#!/usr/bin/env bash
# =============================================================================
# scripts/db/search-benchmark.sh — pomiar wyszukiwania ofert na PostgreSQL 16 (#47).
#
# Tworzy jednorazową bazę z produkcyjnym bootstrapem i wszystkimi migracjami, wstawia
# syntetyczne oferty (tytuły PL/RO/UK/FR/NL/EN, belgijskie miasta w kilku zapisach)
# i dla zestawu zapytań wypisuje: liczbę wyników `get_public_jobs_count`, czas
# i węzeł planu dla tabeli jobs z wywołania `get_public_jobs` (auto_explain z
# zagnieżdżonymi instrukcjami — plan ciała funkcji, nie kopii SQL). Pomiar wykonuje
# dwa razy: na migracjach do BENCH_BASELINE włącznie (domyślnie 0108 — przed
# wyszukiwaniem bez diakrytyków 0109) i po zastosowaniu pozostałych migracji.
#
# Użycie jak test-rls.sh (peer auth: sudo -u postgres bash …, albo PGHOST/PGUSER/…).
#   BENCH_JOBS — liczba ofert (domyślnie 20000). Baza jest usuwana na końcu.
#   BENCH_BASELINE — ostatnia migracja stanu „przed” (domyślnie 0108).
# Skrypt niczego nie asertuje (to pomiar, nie test) — kończy się kodem 0, gdy pomiar
# się wykonał. Wyniki: docs/railway/OPERATIONS.md („Wyszukiwanie").
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB=pracujbe_search_bench
JOBS="${BENCH_JOBS:-20000}"
BASELINE="${BENCH_BASELINE:-0108}"
[[ "$BASELINE" =~ ^[0-9]{4}$ ]] || { echo 'BENCH_BASELINE musi mieć postać NNNN.'; exit 2; }
[[ "$JOBS" =~ ^[0-9]+$ ]] && [ "$JOBS" -ge 100 ] || { echo 'BENCH_JOBS musi być liczbą >= 100.'; exit 2; }

psql_base=(psql -v ON_ERROR_STOP=1 -X -q)
[ -n "${PGHOST:-}" ] && psql_base+=(-h "$PGHOST")
[ -n "${PGPORT:-}" ] && psql_base+=(-p "$PGPORT")
[ -n "${PGUSER:-}" ] && psql_base+=(-U "$PGUSER")

cleanup() { "${psql_base[@]}" -d postgres -c "drop database if exists $DB;" >/dev/null 2>&1 || true; }
[ -n "${BENCH_KEEP:-}" ] || trap cleanup EXIT

# Pliki migracji w kolejności migratora; $1 = before|after względem BASELINE.
migration_files() {
  for f in "$ROOT"/supabase/migrations/0*.sql "$ROOT"/database/auth/0*.sql; do
    printf '%s\t%s\n' "$(basename "$f")" "$f"
  done | LC_ALL=C sort | while IFS=$'\t' read -r name file; do
    local after=0
    [[ "$file" == */supabase/migrations/* && "${name:0:4}" > "$BASELINE" ]] && after=1
    if [ "$1" = before ] && [ "$after" = 0 ]; then echo "$file"; fi
    if [ "$1" = after ] && [ "$after" = 1 ]; then echo "$file"; fi
  done
}

echo ">> baza: bootstrap + migracje do $BASELINE"
"${psql_base[@]}" -d postgres -c "drop database if exists $DB;" -c "create database $DB;" >/dev/null
"${psql_base[@]}" -d "$DB" -1 -f "$ROOT/database/bootstrap/0001_roles_and_identity.sql" >/dev/null 2>&1
while IFS= read -r file; do
  "${psql_base[@]}" -d "$DB" -1 -f "$file" >/dev/null 2>&1
done < <(migration_files before)

echo ">> dane: $JOBS ofert (syntetyczne, is_demo=true)"
"${psql_base[@]}" -d "$DB" -v jobs="$JOBS" <<'SQL' >/dev/null
set session_replication_role = replica;  -- bez strażników publikacji: dane pomiarowe
insert into public.companies(id, name, status, is_demo)
select gen_random_uuid(), 'Bench ' || g, 'verified', true from generate_series(1, 200) g;
with titles(t) as (values
  ('Pracownik sprzątania'), ('Kierowca C+E'), ('Magazynier z wózkiem widłowym'),
  ('Muncitor în depozit'), ('Șofer camion'), ('Operator curățenie'),
  ('Водій вантажівки'), ('Прибиральниця'), ('Працівник складу'),
  ('Agent de nettoyage'), ('Chauffeur poids lourd'), ('Préparateur de commandes'),
  ('Magazijnmedewerker'), ('Vrachtwagenchauffeur'), ('Schoonmaker'),
  ('Warehouse operative'), ('Truck driver'), ('Cleaner')),
cities(c) as (values ('Bruxelles'), ('Brussel'), ('Antwerpen'), ('Liège'), ('Gent'),
  ('Charleroi'), ('Namur'), ('Leuven'), ('Mechelen'), ('Brugge'), ('Hasselt'), ('Mons')),
t as (select t, row_number() over () - 1 as i from titles),
c as (select c, row_number() over () - 1 as i from cities),
co as (select id, row_number() over (order by id) - 1 as i from public.companies)
insert into public.jobs(company_id, slug, title, status, category, contract_type, city, region,
  published_at, is_demo)
select co.id, 'bench-' || g, t.t, 'active',
  (enum_range(null::job_category))[1 + g % array_length(enum_range(null::job_category), 1)],
  (enum_range(null::contract_type))[1 + g % array_length(enum_range(null::contract_type), 1)],
  c.c, 'BE', now() - make_interval(mins => g), true
from generate_series(1, :jobs) g
join t on t.i = g % 18
join c on c.i = (g / 18) % 12
join co on co.i = g % 200;
-- Część ofert nieaktywna/usunięta — jak na produkcji indeks częściowy ich nie obejmuje.
update public.jobs set status = 'closed' where slug ~ '[05]$';
insert into public.job_translations(job_id, locale, title)
select id, 'en', title || ' (EN)' from public.jobs where slug ~ '[13579]$';
set session_replication_role = origin;
analyze;
SQL

run_queries() {
  local label="$1"
  echo
  echo "=== $label ==="
  printf '%-34s %8s %10s  %s\n' 'zapytanie (keyword | city)' 'wyniki' 'czas ms' 'węzeł jobs'
  while IFS='|' read -r kw city; do
    local kw_sql city_sql
    kw_sql=$([ -n "$kw" ] && printf "'%s'" "$kw" || printf 'null')
    city_sql=$([ -n "$city" ] && printf "'%s'" "$city" || printf 'null')
    local count out node ms
    count="$("${psql_base[@]}" -d "$DB" -At -c "select public.get_public_jobs_count('pl', $kw_sql, $city_sql)")"
    # Ta sama sesja wywołuje listę dwa razy; mierzymy drugi przebieg (rozgrzany cache).
    # auto_explain loguje najpierw instrukcję zagnieżdżoną (ciało funkcji), potem zewnętrzną:
    # blok 3 = ciało get_public_jobs w drugim wywołaniu.
    out="$("${psql_base[@]}" -d "$DB" -At 2>&1 <<SQL
load 'auto_explain';
set auto_explain.log_min_duration = 0;
set auto_explain.log_nested_statements = on;
set auto_explain.log_analyze = on;
set auto_explain.log_level = notice;
set client_min_messages = notice;
select count(*) from public.get_public_jobs('pl', $kw_sql, $city_sql, p_limit => 20);
select count(*) from public.get_public_jobs('pl', $kw_sql, $city_sql, p_limit => 20);
SQL
)"
    # Każda instrukcja (także pomocnicze funkcje wynagrodzenia) to osobny blok „duration:".
    # Ciało get_public_jobs = ostatni blok z węzłem tabeli jobs (drugie, rozgrzane wywołanie).
    local block
    block="$(awk '/duration: / {if (b ~ / on jobs j/) last = b; b = ""} {b = b $0 "\n"}
      END {if (b ~ / on jobs j/) last = b; printf "%s", last}' <<<"$out")"
    ms="$(grep -oE 'duration: [0-9]+\.[0-9]+' <<<"$block" | grep -oE '[0-9]+\.[0-9]+' || true)"
    node="$(grep -E ' on jobs j' <<<"$block" | head -1 \
      | sed -E 's/^[^A-Za-z]*//; s/ +\(cost.*//' || true)"
    if [[ "$node" == Bitmap* ]]; then
      node+=" ($(grep -oE 'Bitmap Index Scan on [a-z_]+' <<<"$block" | head -1 | awk '{print $NF}'))"
    fi
    printf '%-34s %8s %10s  %s\n' "${kw:-—} | ${city:-—}" "${count:-?}" "${ms:-?}" "${node:-?}"
  done <<'Q'
sprzątanie|
sprzątania|
sprzatania|
SPRZATANIA|
50%|
_|
Șofer|
sofer|
Водій|
nettoyage|
Préparateur|
Preparateur|
magazijn|
warehouse|
|Bruxelles
|Brussel
|Brussels
|Liège
|Liege
|Luik
Kierowca|Gent
Q
}

run_queries "PRZED (migracje do $BASELINE)"
echo
echo ">> migracje po $BASELINE"
while IFS= read -r file; do
  echo "   $(basename "$file")"
  "${psql_base[@]}" -d "$DB" -1 -f "$file" >/dev/null
done < <(migration_files after)
"${psql_base[@]}" -d "$DB" -c 'analyze;' >/dev/null
run_queries "PO (wszystkie migracje)"
echo
echo "Search benchmark: DONE ($JOBS ofert, PostgreSQL $("${psql_base[@]}" -d "$DB" -At -c 'show server_version'))"
