#!/usr/bin/env bash
# =============================================================================
# scripts/db/restore-backup.sh — odtworzenie zaszyfrowanej kopii z backup.sh (#47).
#
# 1. manifest obok artefaktu (<nazwa>.json): format i SHA-256 artefaktu,
# 2. odszyfrowanie `age` kluczem prywatnym do katalogu roboczego 0700,
# 3. pełny odczyt archiwum (pg_restore --list),
# 4. odtworzenie do PUSTEJ, izolowanej bazy pracujbe_restore_* (bez właścicieli i ACL;
#    brakujące role polityk RLS tworzone na celu jako NOLOGIN bez atrybutów),
# 5. zapytania kontrolne (scripts/db/lib/backup-controls.sh) — SHA-256 wyniku musi być
#    równy `controlsSha256` z manifestu: historia migracji, RLS, polityki, liczności tabel,
# 6. (opcjonalnie, #486) ponowne usunięcie osób z rejestru usunięć NOWSZEGO niż kopia
#    (plik z scripts/db/export-erasure-tombstones.sh) — public.apply_erasure_tombstones,
#    potem kontrola, że żadna z nich nie istnieje w odtworzonej bazie.
#
# Wejście wyłącznie ze zmiennych środowiskowych:
#   RESTORE_ARCHIVE            — ścieżka artefaktu pracujbe-*.dump.age,
#   RESTORE_AGE_IDENTITY_FILE  — klucz prywatny age (trzymany POZA zadaniem kopii),
#   RESTORE_TARGET_URL         — pusta baza pracujbe_restore_* (zalecany osobny klaster),
#   RESTORE_TOMBSTONES_FILE    — (opcjonalnie) rejestr usunięć do ponownego zastosowania.
#   RESTORE_S3_OBJECT          — #569: zamiast RESTORE_ARCHIVE: nazwa artefaktu w buckecie R2
#                                albo `latest` (najnowsza kompletna kopia); pobranie kluczem
#                                ODCZYTU BACKUP_S3_READ_* (scripts/db/lib/backup-s3.mjs).
# Skrypt nie wypisuje URL-i, haseł ani danych. Nie usuwa baz. Nie pisze do źródła.
#
# Kod wyjścia: 0 = odtworzono i zgodne z manifestem; 1 = niezgodność/błąd; 2 = konfiguracja.
# =============================================================================
set -euo pipefail
umask 077

fail() { echo "RESTORE: $1" >&2; exit "${2:-1}"; }

download_dir=''
if [ -n "${RESTORE_S3_OBJECT:-}" ]; then
  [ -z "${RESTORE_ARCHIVE:-}" ] || fail 'Ustaw RESTORE_ARCHIVE albo RESTORE_S3_OBJECT, nie oba.' 2
  command -v node >/dev/null || fail 'Brak programu node (pobranie z R2).' 2
  s3_cli="$(dirname "$0")/lib/backup-s3.mjs"
  s3_msg="$(node "$s3_cli" check read 2>&1 >/dev/null)" || fail "Konfiguracja R2: ${s3_msg#BACKUP_S3: }" 2
  object="$RESTORE_S3_OBJECT"
  if [ "$object" = 'latest' ]; then
    object="$(node "$s3_cli" latest)" || fail 'Brak kompletnej kopii w R2 albo bucket niedostępny.'
  fi
  [[ "$object" =~ ^pracujbe-[0-9]{8}T[0-9]{6}Z\.dump\.age$ ]] || fail 'Nieoczekiwana nazwa obiektu R2.' 2
  download_dir="$(mktemp -d)"
  trap 'rm -rf "$download_dir"' EXIT
  echo 'RESTORE: pobranie artefaktu i manifestu z R2'
  node "$s3_cli" download "$object" "$download_dir" >/dev/null || fail 'Pobranie kopii z R2 nie powiodło się.'
  RESTORE_ARCHIVE="$download_dir/$object"
fi
[ -n "${RESTORE_ARCHIVE:-}" ] || fail 'Ustaw RESTORE_ARCHIVE albo RESTORE_S3_OBJECT.' 2
[ -n "${RESTORE_AGE_IDENTITY_FILE:-}" ] || fail 'Ustaw RESTORE_AGE_IDENTITY_FILE.' 2
[ -n "${RESTORE_TARGET_URL:-}" ] || fail 'Ustaw RESTORE_TARGET_URL.' 2
[ -r "$RESTORE_ARCHIVE" ] || fail 'Artefakt jest nieczytelny.' 2
[ -r "$RESTORE_AGE_IDENTITY_FILE" ] || fail 'Klucz age jest nieczytelny.' 2
for bin in pg_restore psql age sha256sum; do
  command -v "$bin" >/dev/null || fail "Brak programu $bin." 2
done

archive_name="$(basename "$RESTORE_ARCHIVE")"
[[ "$archive_name" =~ ^pracujbe-[0-9]{8}T[0-9]{6}Z\.dump\.age$ ]] || fail 'Nieoczekiwana nazwa artefaktu.' 2
manifest="$(dirname "$RESTORE_ARCHIVE")/${archive_name%.dump.age}.json"
[ -r "$manifest" ] || fail 'Brak manifestu kopii.' 2

# Manifest pisze backup.sh: płaski JSON, jeden klucz w wierszu.
field() { sed -nE "s/^  \"$1\": \"?([^\",]*)\"?,?$/\1/p" "$manifest" | head -1; }
[ "$(field format)" = 'pracujbe-backup/1' ] || fail 'Nieobsługiwany format manifestu.' 2
[ "$(field artifact)" = "$archive_name" ] || fail 'Manifest dotyczy innego artefaktu.'
expected_sha="$(field sha256Encrypted)"
expected_controls="$(field controlsSha256)"
[[ "$expected_sha" =~ ^[0-9a-f]{64}$ && "$expected_controls" =~ ^[0-9a-f]{64}$ ]] \
  || fail 'Manifest bez sum kontrolnych.'

url_db() { local u="${1%%\?*}"; printf '%s' "${u##*/}"; }
[[ "$(url_db "$RESTORE_TARGET_URL")" =~ ^pracujbe_restore_[a-z0-9_]+$ ]] \
  || fail 'Baza docelowa musi nazywać się pracujbe_restore_* (ochrona przed nadpisaniem).' 2
dst() { psql -X -q -v ON_ERROR_STOP=1 -At --dbname="$RESTORE_TARGET_URL" "$@"; }
occupied="$(dst -c "select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
  where n.nspname not in ('pg_catalog','information_schema','pg_toast') and n.nspname not like 'pg_temp%'
    and n.nspname not like 'pg_toast_temp%'")" || fail 'Brak połączenia z bazą docelową.' 2
[ "$occupied" = "0" ] || fail 'Baza docelowa nie jest pusta.' 2

# Rejestr usunięć sprawdzamy PRZED odtworzeniem — zły plik nie zostawia bazy bez ponownego usunięcia.
tombstone_array=''
tombstone_count=0
if [ -n "${RESTORE_TOMBSTONES_FILE:-}" ]; then
  [ -r "$RESTORE_TOMBSTONES_FILE" ] || fail 'Rejestr usunięć jest nieczytelny.' 2
  [ "$(head -1 "$RESTORE_TOMBSTONES_FILE")" = 'pracujbe-erasure-tombstones/1' ] \
    || fail 'Nieobsługiwany format rejestru usunięć.' 2
  if tail -n +2 "$RESTORE_TOMBSTONES_FILE" \
      | grep -Evq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
    fail 'Rejestr usunięć zawiera nieprawidłowy wiersz.' 2
  fi
  tombstone_count="$(tail -n +2 "$RESTORE_TOMBSTONES_FILE" | grep -c . || true)"
  tombstone_array="{$(tail -n +2 "$RESTORE_TOMBSTONES_FILE" | paste -sd, -)}"
fi

echo 'RESTORE: suma kontrolna artefaktu'
[ "$(sha256sum "$RESTORE_ARCHIVE" | cut -d' ' -f1)" = "$expected_sha" ] \
  || fail 'Suma SHA-256 artefaktu niezgodna z manifestem (uszkodzony lub podmieniony).'

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"; if [ -n "$download_dir" ]; then rm -rf "$download_dir"; fi' EXIT
dump="$workdir/pracujbe.dump"

echo 'RESTORE: odszyfrowanie (age)'
age --decrypt --identity "$RESTORE_AGE_IDENTITY_FILE" --output "$dump" "$RESTORE_ARCHIVE" 2>/dev/null \
  || fail 'Odszyfrowanie nie powiodło się (zły klucz albo uszkodzony artefakt).'

echo 'RESTORE: pełny odczyt archiwum'
pg_restore --list "$dump" >"$workdir/toc.txt" 2>/dev/null || fail 'Archiwum jest nieczytelne.'
[ -s "$workdir/toc.txt" ] || fail 'Archiwum jest puste.'

# Role z klauzul TO polityk (CREATE POLICY … TO a, b USING …) — tylko prawidłowe nazwy.
roles="$(pg_restore --schema-only --file=- "$dump" 2>/dev/null \
  | sed -nE 's/^CREATE POLICY .* TO ([a-z_][a-z0-9_]*( *, *[a-z_][a-z0-9_]*)*)( USING| WITH CHECK|;).*/\1/p' \
  | tr ',' '\n' | tr -d ' ' | grep -v '^public$' | LC_ALL=C sort -u || true)"
for role in $roles; do
  [[ "$role" =~ ^[a-z_][a-z0-9_]*$ ]] || fail 'Nieoczekiwana nazwa roli w polityce.'
  if [ -z "$(dst -c "select 1 from pg_roles where rolname = '$role'")" ]; then
    dst -c "create role \"$role\" nologin" >/dev/null || fail 'Nie można utworzyć roli na celu.' 2
  fi
done

echo 'RESTORE: odtwarzanie do izolowanej bazy'
pg_restore --no-owner --no-acl --exit-on-error --single-transaction \
  --dbname="$RESTORE_TARGET_URL" "$dump" 2>"$workdir/restore.err" || fail 'pg_restore nie powiódł się.'
rm -f "$dump"

echo 'RESTORE: zapytania kontrolne'
# shellcheck source=scripts/db/lib/backup-controls.sh
source "$(dirname "$0")/lib/backup-controls.sh"
table_list="$(dst -c "$BACKUP_TABLES_SQL")" || fail 'Odczyt listy tabel celu.'
controls="$(backup_controls_sql "$table_list" | dst)" || fail 'Zapytania kontrolne na celu.'
[ "$(printf '%s' "$controls" | sha256sum | cut -d' ' -f1)" = "$expected_controls" ] \
  || fail 'Niezgodność po odtworzeniu: historia migracji, RLS, polityki lub liczności tabel.'

if [ -n "$tombstone_array" ]; then
  echo 'RESTORE: ponowne usunięcie osób z rejestru usunięć'
  # Identyfikatory zweryfikowane wyżej (tylko UUID) — przekazywane jako zmienna psql.
  printf '%s\n' "select public.apply_erasure_tombstones(:'ids'::uuid[]);" \
    | dst -v ids="$tombstone_array" >/dev/null || fail 'Ponowne usunięcie z rejestru nie powiodło się.'
  remaining="$(printf '%s\n' "select (select count(*) from public.profiles where id = any(:'ids'::uuid[]))
      + (select count(*) from auth.users where id = any(:'ids'::uuid[]));" | dst -v ids="$tombstone_array")" \
    || fail 'Kontrola rejestru usunięć nie powiodła się.'
  [ "$remaining" = "0" ] || fail 'Po ponownym usunięciu w bazie zostały osoby z rejestru usunięć.'
  echo "RESTORE: rejestr usunięć zastosowany (liczba identyfikatorów: ${tombstone_count})."
fi

tables="$(printf '%s\n' "$table_list" | grep -c .)"
migrations="$(dst -c 'select count(*) from app_migrations.history')"
echo "RESTORE: PASS — $archive_name: ${tables} tabel, ${migrations} migracji; zgodne z manifestem kopii."
