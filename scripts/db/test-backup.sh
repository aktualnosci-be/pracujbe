#!/usr/bin/env bash
# =============================================================================
# scripts/db/test-backup.sh — test backup.sh + restore-backup.sh na PostgreSQL 16 (#47).
#
# Źródło z produkcyjnym bootstrapem, migracjami i danymi; trzy kopie przy retencji 2,
# odtworzenie najnowszej do pracujbe_restore_bk_ci i kontrole ujemne: podmieniony
# artefakt, zmieniony manifest, zły klucz, niepusty cel, klucz prywatny jako odbiorca,
# brak odbiorców, zła retencja. #486: kandydat usunięty PO kopii wraca przy zwykłym
# odtworzeniu (kontrola ujemna), a z rejestrem usunięć (RESTORE_TOMBSTONES_FILE) jest
# usuwany ponownie; zły rejestr = odmowa. #569: ta sama kopia w buckecie S3 (atrapa R2
# tests/helpers/fake-s3-server.mjs: klucz zapisu i klucz odczytu), retencja w buckecie,
# odtworzenie z R2 (RESTORE_S3_OBJECT=latest) i kontrole ujemne (klucz odczytu nie wyśle
# kopii, niepełna konfiguracja R2). Wymaga: psql/pg_dump/pg_restore, age, age-keygen, node.
# Użycie jak test-rls.sh (PGHOST/PGUSER/PGPASSWORD albo peer auth jako postgres).
# Nie łączy się z internetem (BACKUP_HEARTBEAT_URL nieustawiony).
# =============================================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC_DB=pracujbe_backup_source_ci
DST_DB=pracujbe_restore_bk_ci
unset BACKUP_HEARTBEAT_URL

for bin in age age-keygen pg_dump pg_restore psql node; do
  command -v "$bin" >/dev/null || { echo "Brak programu $bin (test wymaga age)."; exit 2; }
done

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

work="$(mktemp -d)"
recreate() { "${psql_base[@]}" -d postgres -c "drop database if exists $1;" -c "create database $1;" >/dev/null; }
fake_pid=''
cleanup() {
  if [ -n "$fake_pid" ]; then kill "$fake_pid" 2>/dev/null || true; fi
  for db in "$SRC_DB" "$DST_DB"; do "${psql_base[@]}" -d postgres -c "drop database if exists $db;" >/dev/null 2>&1 || true; done
  rm -rf "$work"
}
trap cleanup EXIT

echo '>> źródło: produkcyjny bootstrap + migracje + dane'
recreate "$SRC_DB"
"${psql_base[@]}" -d "$SRC_DB" -1 -f "$ROOT/database/bootstrap/0001_roles_and_identity.sql" >/dev/null 2>&1
while IFS= read -r file; do
  "${psql_base[@]}" -d "$SRC_DB" -1 -f "$file" >/dev/null 2>&1
done < <(for f in "$ROOT"/supabase/migrations/0*.sql "$ROOT"/database/auth/0*.sql; do
  printf '%s\t%s\n' "$(basename "$f")" "$f"
done | LC_ALL=C sort | cut -f2)
"${psql_base[@]}" -d "$SRC_DB" <<'SQL' >/dev/null
create schema if not exists app_migrations;
create table if not exists app_migrations.history(
  name text primary key, checksum text not null, applied_at timestamptz not null default now());
insert into app_migrations.history(name, checksum) values ('0000_test.sql', repeat('b', 64));
insert into auth.users(id, email, name, raw_user_meta_data) values
  ('0f000000-0000-4000-8000-0000000000b1', 'backup@test.invalid', 'Backup', '{"role":"employer"}');
insert into public.companies(id, name, status) values
  ('0f000000-0000-4000-8000-0000000000b2', 'Firma-kopii-zaszyfrowanej', 'verified');
insert into auth.users(id, email, name, raw_user_meta_data) values
  ('0f000000-0000-4000-8000-0000000000c1', 'erased@test.invalid', 'Erased', '{"role":"candidate"}');
insert into public.candidate_profiles(profile_id) values ('0f000000-0000-4000-8000-0000000000c1');
insert into public.files(owner_id, bucket, path, entity_type) values
  ('0f000000-0000-4000-8000-0000000000c1', 'candidate-files', '0f000000-0000-4000-8000-0000000000c1/cv.pdf', 'candidate_cv');
SQL

age-keygen -o "$work/identity.txt" 2>/dev/null
age-keygen -y "$work/identity.txt" >"$work/recipients.txt"
age-keygen -o "$work/other-identity.txt" 2>/dev/null
backups="$work/backups"

run_backup() {
  env BACKUP_SOURCE_URL="$(url "$SRC_DB")" BACKUP_DIR="$backups" \
    BACKUP_AGE_RECIPIENTS_FILE="$work/recipients.txt" BACKUP_RETENTION=2 "$@" \
    bash "$ROOT/scripts/db/backup.sh"
}

echo '>> trzy kopie, retencja 2'
for i in 1 2 3; do
  out="$(run_backup)"
  printf '%s\n' "$out" | tail -1
  grep -q '^BACKUP: PASS' <<<"$out" || { echo 'Brak PASS kopii'; exit 1; }
  [ "$i" = 3 ] || sleep 1.1
done
mapfile -t artifacts < <(find "$backups" -maxdepth 1 -name 'pracujbe-*.dump.age' -printf '%f\n' | LC_ALL=C sort)
[ "${#artifacts[@]}" = 2 ] || { echo "Retencja: ${#artifacts[@]} kopii zamiast 2"; exit 1; }
[ "$(find "$backups" -maxdepth 1 -type f | wc -l)" = 4 ] \
  || { echo 'W katalogu kopii są pliki inne niż artefakty i manifesty'; exit 1; }
latest="$backups/${artifacts[1]}"
[ "$(stat -c %a "$latest")" = 600 ] && [ "$(stat -c %a "$backups")" = 700 ] \
  || { echo 'Artefakt lub katalog nie ma praw 0600/0700'; exit 1; }
head -c 64 "$latest" | grep -q 'age-encryption.org/v1' || { echo 'Artefakt nie jest w formacie age'; exit 1; }
if grep -aq 'Firma-kopii-zaszyfrowanej' "$latest"; then echo 'Plaintext w artefakcie'; exit 1; fi
grep -q '"controlsSha256": "[0-9a-f]\{64\}"' "${latest%.dump.age}.json" || { echo 'Manifest bez sumy kontroli'; exit 1; }

# Zmiana źródła PO kopii nie wpływa na odtworzenie (kontrola dotyczy chwili zrzutu).
"${psql_base[@]}" -d "$SRC_DB" -c "insert into public.companies(name, status) values ('Po kopii', 'verified')" >/dev/null
# #486: kandydat usuwa konto PO kopii; rejestr usunięć eksportujemy z bieżącego źródła.
ERASED=0f000000-0000-4000-8000-0000000000c1
"${psql_base[@]}" -d "$SRC_DB" -c "select public.erase_candidate_subject('$ERASED', 'self_service', null)" >/dev/null
env TOMBSTONE_SOURCE_URL="$(url "$SRC_DB")" TOMBSTONE_OUTPUT="$work/tombstones.txt" \
  bash "$ROOT/scripts/db/export-erasure-tombstones.sh" | tail -1
[ "$(stat -c %a "$work/tombstones.txt")" = 600 ] && [ "$(sed -n 2p "$work/tombstones.txt")" = "$ERASED" ] \
  || { echo 'Rejestr usunięć: zły plik lub prawa'; exit 1; }
erased_rows() {
  "${psql_base[@]}" -At -d "$DST_DB" -c "select (select count(*) from auth.users where id = '$ERASED')
    + (select count(*) from public.profiles where id = '$ERASED')
    + (select count(*) from public.files where owner_id = '$ERASED')"
}

echo '>> odtworzenie najnowszej kopii'
recreate "$DST_DB"
restore() {
  env RESTORE_ARCHIVE="$latest" RESTORE_AGE_IDENTITY_FILE="$work/identity.txt" \
    RESTORE_TARGET_URL="$(url "$DST_DB")" "$@" bash "$ROOT/scripts/db/restore-backup.sh"
}
out="$(restore)"
printf '%s\n' "$out" | tail -1
grep -q '^RESTORE: PASS' <<<"$out" || { echo 'Brak PASS odtworzenia'; exit 1; }
[ "$("${psql_base[@]}" -At -d "$DST_DB" -c "select string_agg(name, ',' order by name) from public.companies")" \
  = 'Firma-kopii-zaszyfrowanej' ] || { echo 'Dane nie zostały odtworzone'; exit 1; }
# Kontrola ujemna #486: bez rejestru usunięć osoba usunięta po kopii wraca.
[ "$(erased_rows)" = 3 ] || { echo 'Kontrola: kandydat z kopii powinien wrócić bez rejestru usunięć'; exit 1; }
echo '>> kontrola ujemna OK: bez rejestru usunięć dane usuniętej osoby wracają'

echo '>> odtworzenie z rejestrem usunięć (#486)'
recreate "$DST_DB"
out="$(restore RESTORE_TOMBSTONES_FILE="$work/tombstones.txt")"
printf '%s\n' "$out" | tail -2
grep -q '^RESTORE: PASS' <<<"$out" || { echo 'Brak PASS odtworzenia z rejestrem'; exit 1; }
[ "$(erased_rows)" = 0 ] || { echo 'Po odtworzeniu z rejestrem usunięta osoba nadal istnieje'; exit 1; }
[ "$("${psql_base[@]}" -At -d "$DST_DB" -c "select count(*) from public.storage_deletion_queue
    where path = '$ERASED/cv.pdf'")" = 1 ] || { echo 'Obiekt CV z kopii nie trafił do kolejki usuwania'; exit 1; }
recreate "$DST_DB"

expect_code() {
  local expected="$1" label="$2" code=0
  shift 2
  "$@" >/dev/null 2>&1 || code=$?
  [ "$code" = "$expected" ] || { echo "Kontrola ujemna '$label': kod $code zamiast $expected"; exit 1; }
  echo ">> kontrola ujemna OK: $label"
}

printf 'pracujbe-erasure-tombstones/1\nnot-a-uuid\n' >"$work/bad-tombstones.txt"
expect_code 2 'zły rejestr usunięć' restore RESTORE_TOMBSTONES_FILE="$work/bad-tombstones.txt"
[ "$("${psql_base[@]}" -At -d "$DST_DB" -c "select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'")" = 0 ] || { echo 'Zły rejestr: baza została odtworzona mimo odmowy'; exit 1; }
restore >/dev/null
expect_code 2 'cel niepusty' restore
recreate "$DST_DB"
expect_code 1 'zły klucz prywatny' restore RESTORE_AGE_IDENTITY_FILE="$work/other-identity.txt"

tampered="$work/tampered"; mkdir -p "$tampered"
cp "$latest" "${latest%.dump.age}.json" "$tampered/"
t_art="$tampered/$(basename "$latest")"
printf '\x00' | dd of="$t_art" bs=1 seek=200 conv=notrunc status=none
expect_code 1 'podmieniony artefakt' restore RESTORE_ARCHIVE="$t_art"

cp "$latest" "$tampered/"
sed -i -E 's/("controlsSha256": ")[0-9a-f]{64}/\1'"$(printf 'c%.0s' $(seq 64))"'/' "${t_art%.dump.age}.json"
recreate "$DST_DB"
expect_code 1 'manifest niezgodny z danymi' restore RESTORE_ARCHIVE="$t_art"

recreate "$DST_DB"
expect_code 2 'niedozwolona nazwa celu' restore RESTORE_TARGET_URL="$(url postgres)"
expect_code 2 'klucz prywatny jako odbiorca' run_backup BACKUP_AGE_RECIPIENTS_FILE="$work/identity.txt"
: >"$work/empty.txt"
expect_code 2 'brak odbiorców' run_backup BACKUP_AGE_RECIPIENTS_FILE="$work/empty.txt"
expect_code 2 'retencja 0' run_backup BACKUP_RETENTION=0
[ "$(find "$backups" -maxdepth 1 -name 'pracujbe-*.dump.age' | wc -l)" = 2 ] \
  || { echo 'Nieudane uruchomienia zmieniły katalog kopii'; exit 1; }

echo '>> #569: kopie do bucketu S3 (atrapa R2), retencja 2 w buckecie'
node "$ROOT/tests/helpers/fake-s3-server.mjs" "$work/s3-endpoint" &
fake_pid=$!
for _ in $(seq 50); do [ -s "$work/s3-endpoint" ] && break; sleep 0.1; done
[ -s "$work/s3-endpoint" ] || { echo 'Atrapa S3 nie wystartowała'; exit 1; }
s3_common=(BACKUP_S3_ENDPOINT="$(cat "$work/s3-endpoint")" BACKUP_S3_BUCKET=backups BACKUP_S3_PREFIX=ci
  BACKUP_S3_ALLOW_INSECURE_LOCAL=1)
s3_write=("${s3_common[@]}" BACKUP_S3_ACCESS_KEY_ID=write-key BACKUP_S3_SECRET_ACCESS_KEY=write-secret)
s3_read=("${s3_common[@]}" BACKUP_S3_READ_ACCESS_KEY_ID=read-key BACKUP_S3_READ_SECRET_ACCESS_KEY=read-secret)
s3_list() { env "${s3_read[@]}" node "$ROOT/scripts/db/lib/backup-s3.mjs" list; }
for i in 1 2 3; do
  out="$(run_backup "${s3_write[@]}")"
  printf '%s\n' "$out" | tail -1
  grep -q '^BACKUP: PASS.*R2: wysłano' <<<"$out" || { echo 'Brak PASS kopii z wysyłką do R2'; exit 1; }
  [ "$i" = 3 ] || sleep 1.1
done
[ "$(s3_list | grep -c '\.dump\.age$')" = 2 ] && [ "$(s3_list | grep -c '\.json$')" = 2 ] \
  || { echo 'Retencja w R2: oczekiwane 2 kopie (artefakt + manifest)'; exit 1; }
remote_latest="$(env "${s3_read[@]}" node "$ROOT/scripts/db/lib/backup-s3.mjs" latest)"
local_latest="$(find "$backups" -maxdepth 1 -name 'pracujbe-*.dump.age' -printf '%f\n' | LC_ALL=C sort | tail -1)"
[ "$remote_latest" = "$local_latest" ] || { echo 'Najnowsza kopia w R2 różni się od lokalnej'; exit 1; }

echo '>> #569: odtworzenie najnowszej kopii z R2 (klucz odczytu)'
recreate "$DST_DB"
out="$(env RESTORE_S3_OBJECT=latest "${s3_read[@]}" RESTORE_AGE_IDENTITY_FILE="$work/identity.txt" \
  RESTORE_TARGET_URL="$(url "$DST_DB")" bash "$ROOT/scripts/db/restore-backup.sh")"
printf '%s\n' "$out" | tail -1
grep -q '^RESTORE: PASS' <<<"$out" || { echo 'Brak PASS odtworzenia z R2'; exit 1; }
recreate "$DST_DB"
restore_s3() {
  env RESTORE_AGE_IDENTITY_FILE="$work/identity.txt" RESTORE_TARGET_URL="$(url "$DST_DB")" "$@" \
    bash "$ROOT/scripts/db/restore-backup.sh"
}
expect_code 2 'R2: odtworzenie kluczem zapisu zamiast odczytu' restore_s3 RESTORE_S3_OBJECT=latest "${s3_write[@]}"
expect_code 2 'R2: RESTORE_ARCHIVE i RESTORE_S3_OBJECT naraz' restore_s3 RESTORE_S3_OBJECT=latest RESTORE_ARCHIVE="$latest" "${s3_read[@]}"
before="$(s3_list | wc -l)"
expect_code 1 'R2: klucz odczytu nie wyśle kopii' run_backup "${s3_common[@]}" \
  BACKUP_S3_ACCESS_KEY_ID=read-key BACKUP_S3_SECRET_ACCESS_KEY=read-secret
[ "$(s3_list | wc -l)" = "$before" ] || { echo 'Klucz odczytu zmienił zawartość bucketu'; exit 1; }
expect_code 2 'R2: niepełna konfiguracja' run_backup BACKUP_S3_BUCKET=backups
expect_code 2 'R2: endpoint http bez zgody na test lokalny' run_backup "${s3_write[@]}" BACKUP_S3_ALLOW_INSECURE_LOCAL=0

echo 'Backup/restore test: PASS'
