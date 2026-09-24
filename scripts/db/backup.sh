#!/usr/bin/env bash
# =============================================================================
# scripts/db/backup.sh — zaszyfrowana kopia logiczna PostgreSQL z retencją (#47).
#
# 1. pg_dump -Fc ze snapshotu transakcji tylko do odczytu (REPEATABLE READ),
# 2. pełny odczyt archiwum przez pg_restore (--list + odtworzenie do /dev/null),
# 3. szyfrowanie `age` kluczem PUBLICZNYM (zadanie kopii nie zna klucza prywatnego),
# 4. manifest JSON obok artefaktu: rozmiary, SHA-256 artefaktu, SHA-256 zapytań
#    kontrolnych (historia migracji + liczba wierszy każdej tabeli z tego samego
#    snapshotu) — restore-backup.sh porównuje je po odtworzeniu,
# 5. retencja: zostaje BACKUP_RETENTION najnowszych kopii w BACKUP_DIR.
#
# Wejście wyłącznie ze zmiennych środowiskowych (URL-e i hasła nie są wypisywane):
#   BACKUP_SOURCE_URL          — źródło (login tylko do odczytu albo migrator; nie login WWW),
#   BACKUP_DIR                 — katalog artefaktów (tworzony z prawami 0700),
#   BACKUP_AGE_RECIPIENTS_FILE — plik z kluczami publicznymi age (age1…), min. jeden,
#   BACKUP_RETENTION           — ile kopii zachować (domyślnie 14, 1–365),
#   BACKUP_WORK_DIR            — opcjonalnie katalog na chwilowy, niezaszyfrowany zrzut
#                                (domyślnie mktemp; usuwany zawsze, także po błędzie),
#   BACKUP_HEARTBEAT_URL       — opcjonalnie adres „dead man's switch": po sukcesie GET URL,
#                                po błędzie GET URL/fail (brak pingu = alarm po stronie usługi).
#
# Kod wyjścia: 0 = kopia zapisana i odczytana; 1 = błąd kopii; 2 = zła konfiguracja.
# Plaintext istnieje tylko w katalogu roboczym 0700 do chwili zaszyfrowania.
# =============================================================================
set -euo pipefail
umask 077

heartbeat() {
  [ -n "${BACKUP_HEARTBEAT_URL:-}" ] || return 0
  command -v curl >/dev/null || return 0
  curl -fsS -m 10 --retry 2 -o /dev/null "${BACKUP_HEARTBEAT_URL}$1" >/dev/null 2>&1 \
    || echo 'BACKUP: ping heartbeat nieudany (kopia bez zmian).' >&2
}
fail() { echo "BACKUP: $1" >&2; heartbeat /fail; exit "${2:-1}"; }

[ -n "${BACKUP_SOURCE_URL:-}" ] || fail 'Ustaw BACKUP_SOURCE_URL.' 2
[ -n "${BACKUP_DIR:-}" ] || fail 'Ustaw BACKUP_DIR.' 2
[ -n "${BACKUP_AGE_RECIPIENTS_FILE:-}" ] || fail 'Ustaw BACKUP_AGE_RECIPIENTS_FILE.' 2
[ -r "$BACKUP_AGE_RECIPIENTS_FILE" ] || fail 'Plik odbiorców age jest nieczytelny.' 2
grep -qE '^age1[0-9a-z]{58}$' "$BACKUP_AGE_RECIPIENTS_FILE" \
  || fail 'Plik odbiorców nie zawiera klucza publicznego age1….' 2
if grep -q 'AGE-SECRET-KEY' "$BACKUP_AGE_RECIPIENTS_FILE"; then
  fail 'Plik odbiorców zawiera klucz PRYWATNY — zadanie kopii ma znać tylko klucz publiczny.' 2
fi
retention="${BACKUP_RETENTION:-14}"
[[ "$retention" =~ ^[0-9]+$ ]] && [ "$retention" -ge 1 ] && [ "$retention" -le 365 ] \
  || fail 'BACKUP_RETENTION musi być liczbą 1–365.' 2
for bin in pg_dump pg_restore psql age sha256sum; do
  command -v "$bin" >/dev/null || fail "Brak programu $bin." 2
done

mkdir -p "$BACKUP_DIR" || fail 'Nie można utworzyć BACKUP_DIR.' 2
chmod 700 "$BACKUP_DIR" 2>/dev/null || true
[ -w "$BACKUP_DIR" ] || fail 'BACKUP_DIR nie jest zapisywalny.' 2

workdir="$(mktemp -d "${BACKUP_WORK_DIR:-${TMPDIR:-/tmp}}/pracujbe-backup.XXXXXX")" \
  || fail 'Nie można utworzyć katalogu roboczego.' 2
dump="$workdir/pracujbe.dump"

# Sesja kontrolna źródła w REPEATABLE READ: pg_dump dostaje jej snapshot, więc zapytania
# kontrolne widzą dokładnie te dane, które trafiły do zrzutu (także na żywej bazie).
coproc SRC { psql -X -q -At -v ON_ERROR_STOP=1 --dbname="$BACKUP_SOURCE_URL" 2>/dev/null; }
close_src() { if [ -n "${SRC[1]:-}" ]; then eval "exec ${SRC[1]}>&-" 2>/dev/null || true; fi; }
partial=''
manifest_tmp=''
cleanup() {
  close_src
  rm -rf "$workdir"
  if [ -n "$partial" ]; then rm -f -- "$partial"; fi
  if [ -n "$manifest_tmp" ]; then rm -f -- "$manifest_tmp"; fi
}
trap cleanup EXIT

src_tx() {
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

echo 'BACKUP: zrzut źródła (pg_dump -Fc, snapshot transakcji kontrolnej)'
pg_dump --format=custom --no-owner --no-acl --snapshot="$snapshot" \
  --file="$dump" --dbname="$BACKUP_SOURCE_URL" 2>"$workdir/dump.err" || fail 'pg_dump nie powiódł się.'

# Zapytania kontrolne — identyczny SQL wykonuje restore-backup.sh na celu.
# shellcheck source=scripts/db/lib/backup-controls.sh
source "$(dirname "$0")/lib/backup-controls.sh"
[ -n "$(src_tx "select to_regclass('app_migrations.history');")" ] || fail 'Źródło nie ma historii migracji.'
table_list="$(src_tx "$BACKUP_TABLES_SQL")" || fail 'Odczyt listy tabel ze źródła.'
[ -n "$table_list" ] || fail 'Brak tabel w źródle.'
controls="$(src_tx "$(backup_controls_sql "$table_list")")" || fail 'Zapytania kontrolne na źródle.'
migrations="$(src_tx 'select count(*) from app_migrations.history;')" || fail 'Odczyt historii migracji.'
last_migration="$(src_tx 'select coalesce(max(name), '"''"') from app_migrations.history;')" \
  || fail 'Odczyt historii migracji.'
server_version="$(src_tx 'show server_version;')" || fail 'Odczyt wersji serwera.'
src_tx 'commit;' >/dev/null || true
close_src

echo 'BACKUP: pełny odczyt archiwum (pg_restore)'
pg_restore --list "$dump" >"$workdir/toc.txt" 2>/dev/null || fail 'Archiwum jest nieczytelne.'
[ -s "$workdir/toc.txt" ] || fail 'Archiwum jest puste.'
pg_restore --file=/dev/null "$dump" 2>/dev/null || fail 'Pełny odczyt archiwum nie powiódł się.'

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
name="pracujbe-${stamp}.dump.age"
[ ! -e "$BACKUP_DIR/$name" ] || fail 'Kopia o tym znaczniku czasu już istnieje.'
partial="$BACKUP_DIR/.${name}.partial"

echo 'BACKUP: szyfrowanie (age, klucz publiczny)'
age --encrypt --recipients-file "$BACKUP_AGE_RECIPIENTS_FILE" --output "$partial" "$dump" \
  || fail 'Szyfrowanie nie powiodło się.'
plain_bytes="$(stat -c %s "$dump")"
rm -f "$dump"
enc_bytes="$(stat -c %s "$partial")"
[ "$enc_bytes" -gt 0 ] || fail 'Pusty artefakt.'
enc_sha="$(sha256sum "$partial" | cut -d' ' -f1)"
controls_sha="$(printf '%s' "$controls" | sha256sum | cut -d' ' -f1)"
tables="$(printf '%s\n' "$table_list" | grep -c .)"

json_str() { printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'; }
manifest_tmp="$BACKUP_DIR/.${name%.dump.age}.json.partial"
cat >"$manifest_tmp" <<JSON
{
  "format": "pracujbe-backup/1",
  "createdAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "artifact": "$name",
  "encryption": "age",
  "bytesEncrypted": $enc_bytes,
  "bytesPlain": $plain_bytes,
  "sha256Encrypted": "$enc_sha",
  "controlsSha256": "$controls_sha",
  "tables": $tables,
  "migrations": $migrations,
  "lastMigration": "$(json_str "$last_migration")",
  "serverVersion": "$(json_str "$server_version")"
}
JSON
# Najpierw manifest, potem artefakt: kopia widoczna pod końcową nazwą jest kompletna.
mv "$manifest_tmp" "$BACKUP_DIR/${name%.dump.age}.json"
mv "$partial" "$BACKUP_DIR/$name"
partial=''
manifest_tmp=''

# Retencja: tylko pliki o dokładnym wzorcu nazwy; najnowsza (bieżąca) zostaje zawsze.
removed=0
mapfile -t all < <(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'pracujbe-*.dump.age' -printf '%f\n' \
  | grep -E '^pracujbe-[0-9]{8}T[0-9]{6}Z\.dump\.age$' | LC_ALL=C sort -r)
for old in "${all[@]:$retention}"; do
  [ "$old" != "$name" ] || continue
  rm -f -- "$BACKUP_DIR/$old" "$BACKUP_DIR/${old%.dump.age}.json"
  removed=$((removed + 1))
done
kept=$(( ${#all[@]} - removed ))

heartbeat ''
echo "BACKUP: PASS — $name, ${enc_bytes} B zaszyfrowane (${plain_bytes} B zrzutu), ${tables} tabel, ${migrations} migracji; retencja: zachowano ${kept}, usunięto ${removed}."
