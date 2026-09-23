#!/usr/bin/env bash
# =============================================================================
# scripts/db/verify-restore.sh — dowód, że kopię PostgreSQL da się odtworzyć (#47).
#
# 1. pg_dump -Fc bazy źródłowej ze snapshotu transakcji tylko do odczytu,
# 2. pełny odczyt archiwum (pg_restore --list),
# 3. odtworzenie do PUSTEJ, izolowanej bazy docelowej (bez właścicieli i ACL —
#    role są globalne dla klastra i nie są częścią kopii danych),
# 4. zapytania kontrolne: identyczna historia migracji (nazwy + SHA-256),
#    identyczna liczba wierszy w każdej tabeli public/auth/app_migrations,
#    identyczny zestaw tabel z włączonym RLS i liczba polityk. Liczności źródła
#    czytamy z tego samego snapshotu co pg_dump, więc test działa na żywej bazie.
#
# Wejście wyłącznie ze zmiennych środowiskowych (nie z argumentów — nie trafiają
# do listy procesów ani historii powłoki):
#   RESTORE_SOURCE_URL   — źródło (np. login tylko do odczytu lub migrator),
#   RESTORE_TARGET_URL   — cel: baza o nazwie pracujbe_restore_*, pusta,
#                          inna niż źródło; zalecany osobny klaster,
#   RESTORE_KEEP_DUMP    — opcjonalnie ścieżka, pod którą zachować archiwum
#                          (szyfrowanie i retencja artefaktu — poza skryptem, #47).
# Skrypt nie wypisuje URL-i ani haseł. Nie usuwa żadnej bazy. Nigdy nie pisze do źródła.
#
# Kod wyjścia: 0 = kopia odtworzona i zgodna; 1 = niezgodność/błąd; 2 = zła konfiguracja.
# =============================================================================
set -euo pipefail
umask 077

fail() { echo "RESTORE: $1" >&2; exit "${2:-1}"; }

[ -n "${RESTORE_SOURCE_URL:-}" ] || fail 'Ustaw RESTORE_SOURCE_URL.' 2
[ -n "${RESTORE_TARGET_URL:-}" ] || fail 'Ustaw RESTORE_TARGET_URL.' 2
for bin in pg_dump pg_restore psql; do
  command -v "$bin" >/dev/null || fail "Brak programu $bin." 2
done

# Nazwa i położenie bazy z URL (bez wypisywania). postgres://user:pass@host:port/db?params
url_db()   { local u="${1%%\?*}"; printf '%s' "${u##*/}"; }
url_host() { local u="${1#*://}"; u="${u##*@}"; u="${u%%/*}"; printf '%s' "$u"; }

target_db="$(url_db "$RESTORE_TARGET_URL")"
[[ "$target_db" =~ ^pracujbe_restore_[a-z0-9_]+$ ]] \
  || fail 'Baza docelowa musi nazywać się pracujbe_restore_* (ochrona przed nadpisaniem).' 2
if [ "$(url_host "$RESTORE_SOURCE_URL")/$(url_db "$RESTORE_SOURCE_URL")" = \
     "$(url_host "$RESTORE_TARGET_URL")/$target_db" ]; then
  fail 'Źródło i cel wskazują tę samą bazę.' 2
fi

src()  { psql -X -q -v ON_ERROR_STOP=1 -At --dbname="$RESTORE_SOURCE_URL" "$@"; }
dst()  { psql -X -q -v ON_ERROR_STOP=1 -At --dbname="$RESTORE_TARGET_URL" "$@"; }

occupied="$(dst -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%'
    and n.nspname not like 'pg_toast_temp%'")" || fail 'Brak połączenia z bazą docelową.' 2
[ "$occupied" = "0" ] || fail 'Baza docelowa nie jest pusta.' 2

workdir="$(mktemp -d)"
dump="$workdir/pracujbe.dump"

# Jedna transakcja REPEATABLE READ na źródle: eksportowany snapshot dostaje pg_dump,
# a liczności i zapytania kontrolne czytamy z TEGO SAMEGO snapshotu — wynik jest
# porównywalny także na żywej produkcji, bez blokowania zapisów.
coproc SRC { psql -X -q -At -v ON_ERROR_STOP=1 --dbname="$RESTORE_SOURCE_URL" 2>/dev/null; }
# Sesję źródła kończymy zamknięciem jej wejścia (psql kończy się sam po EOF), nigdy
# sygnałem: w CI skrypt działa jako root w kontenerze serwera, więc `kill` z PID-em
# pomocniczego procesu mógł trafić w proces serwera PostgreSQL i wywołać jego restart.
close_src() {
  if [ -n "${SRC[1]:-}" ]; then
    eval "exec ${SRC[1]}>&-" 2>/dev/null || true
  fi
}
trap 'close_src; rm -rf "$workdir"' EXIT

src_tx() {
  # Wysyła SQL do sesji źródła i czyta wynik do znacznika końca.
  local line out=''
  printf '%s\n\\echo __PRACUJBE_END__\n' "$1" >&"${SRC[1]}"
  while IFS= read -r -t 120 line <&"${SRC[0]}"; do
    [ "$line" = '__PRACUJBE_END__' ] && { printf '%s' "$out"; return 0; }
    out+="${out:+$'\n'}$line"
  done
  return 1
}

snapshot="$(src_tx "begin isolation level repeatable read read only; select pg_export_snapshot();")" \
  || fail 'Brak połączenia ze źródłem.' 2
[[ "$snapshot" =~ ^[0-9A-F-]+$ ]] || fail 'Nie udało się wyeksportować snapshotu źródła.'

echo 'RESTORE: zrzut źródła (pg_dump -Fc, snapshot transakcji kontrolnej)'
pg_dump --format=custom --no-owner --no-acl --snapshot="$snapshot" \
  --file="$dump" --dbname="$RESTORE_SOURCE_URL" 2>"$workdir/dump.err" \
  || fail 'pg_dump nie powiódł się.'

echo 'RESTORE: pełny odczyt archiwum'
pg_restore --list "$dump" >"$workdir/toc.txt" 2>/dev/null || fail 'Archiwum jest nieczytelne.'
[ -s "$workdir/toc.txt" ] || fail 'Archiwum jest puste.'

# Polityki RLS odwołują się do ról globalnych klastra. Na izolowanym celu tworzymy
# brakujące role jako NOLOGIN bez atrybutów — wyłącznie po to, by DDL polityk się wykonał.
roles="$(src_tx "select coalesce(string_agg(distinct r.rolname, ' '), '') from pg_policy p
  cross join unnest(p.polroles) as pr(oid) join pg_roles r on r.oid = pr.oid;")" \
  || fail 'Odczyt ról polityk ze źródła.'
for role in $roles; do
  [[ "$role" =~ ^[a-z_][a-z0-9_]*$ ]] || fail 'Nieoczekiwana nazwa roli w polityce.'
  if [ -z "$(dst -c "select 1 from pg_roles where rolname = '$role'")" ]; then
    dst -c "create role \"$role\" nologin" >/dev/null || fail 'Nie można utworzyć roli na celu.' 2
  fi
done

echo 'RESTORE: odtwarzanie do izolowanej bazy'
pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
  --dbname="$RESTORE_TARGET_URL" "$dump" 2>"$workdir/restore.err" \
  || fail 'pg_restore nie powiódł się.'

# Zapytania kontrolne — ten sam SQL na źródle (snapshot) i celu, porównanie wyników.
history_sql="select coalesce(string_agg(name || ':' || checksum, E'\n' order by name), '')
  from app_migrations.history;"
rls_sql="select coalesce(string_agg(n.nspname || '.' || c.relname, E'\n' order by n.nspname, c.relname), '')
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and c.relrowsecurity and n.nspname in ('public','auth');"
policies_sql="select count(*) from pg_policy;"
tables_sql="select format('%I.%I', n.nspname, c.relname)
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
  where c.relkind in ('r','p') and n.nspname in ('public','auth','app_migrations')
  order by 1;"

compare() {
  local label="$1" sql="$2" a b
  a="$(src_tx "$sql")" || fail "Zapytanie kontrolne na źródle: $label."
  b="$(dst -c "$sql")" || fail "Zapytanie kontrolne na celu: $label."
  [ "$a" = "$b" ] || fail "Niezgodność po odtworzeniu: $label."
}

echo 'RESTORE: zapytania kontrolne'
[ -n "$(src_tx "select to_regclass('app_migrations.history');")" ] \
  || fail 'Źródło nie ma historii migracji.'
compare 'historia migracji (nazwy i SHA-256)' "$history_sql"
compare 'tabele z RLS' "$rls_sql"
compare 'liczba polityk RLS' "$policies_sql"
compare 'lista tabel' "$tables_sql"

# Deskryptory coprocesu nie są dostępne w potoku — najpierw wynik do zmiennej.
table_list="$(src_tx "$tables_sql")" || fail 'Odczyt listy tabel ze źródła.'
counts_sql="$(printf '%s\n' "$table_list" | awk '{q=$0; gsub(/\x27/, "\x27\x27", q); printf "select \x27%s \x27 || count(*) from %s;\n", q, $0}')"
[ -n "$counts_sql" ] || fail 'Brak tabel do porównania.'
a="$(src_tx "$counts_sql")" || fail 'Liczenie wierszy na źródle.'
b="$(printf '%s\n' "$counts_sql" | dst)" || fail 'Liczenie wierszy na celu.'
[ "$a" = "$b" ] || fail 'Niezgodność liczby wierszy po odtworzeniu.'
src_tx 'commit;' >/dev/null || true

tables="$(printf '%s\n' "$a" | grep -c . || true)"
rows="$(printf '%s\n' "$a" | awk '{s += $NF} END {print s + 0}')"
migrations="$(dst -c 'select count(*) from app_migrations.history')"

if [ -n "${RESTORE_KEEP_DUMP:-}" ]; then
  cp "$dump" "$RESTORE_KEEP_DUMP"
  echo 'RESTORE: archiwum zachowane (ścieżka z RESTORE_KEEP_DUMP)'
fi

echo "RESTORE: PASS — ${tables} tabel, ${rows} wierszy, ${migrations} migracji; liczności, RLS i polityki zgodne."
