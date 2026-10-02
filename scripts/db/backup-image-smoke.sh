#!/usr/bin/env bash
# =============================================================================
# scripts/db/backup-image-smoke.sh — smoke zbudowanego obrazu kopii (#751).
#
# Uruchamia obraz z docker/backup/Dockerfile (job CI „Backup image (build + scan)”) i
# sprawdza, że zawiera to, czego potrzebuje backup.sh/restore-backup.sh:
#   - działa jako użytkownik bez uprawnień (uid ≠ 0, użytkownik `node`),
#   - node 22, pg_dump/pg_restore/psql w wersji PG_MAJOR (domyślnie 18), age,
#   - bez npm/npx/yarn (niepotrzebne w czasie działania, poza SBOM i skanem),
#   - @aws-sdk/client-s3 w wersji z package.json (import ESM jak w backup-s3.mjs),
#   - start bez konfiguracji kończy się kodem 2 (zła konfiguracja) i nie wypisuje
#     wartości zmiennych (kanarek w BACKUP_SOURCE_URL nie trafia na wyjście).
# Bez sekretów i bez sieci w kontenerze (--network none).
#
# Użycie: bash scripts/db/backup-image-smoke.sh <obraz>
#   DOCKER        — program docker (domyślnie `docker`; test podstawia atrapę),
#   PG_MAJOR      — oczekiwana wersja główna klienta PostgreSQL (domyślnie 18),
#   AWS_SDK_S3_VERSION — oczekiwana wersja SDK (domyślnie z package.json).
# Kod wyjścia: 0 = obraz zgodny; 1 = niezgodność (komunikat wskazuje sprawdzenie).
# =============================================================================
set -euo pipefail

image="${1:-}"
[ -n "$image" ] || { echo 'BACKUP_IMAGE_SMOKE: podaj nazwę obrazu.' >&2; exit 1; }
docker_bin="${DOCKER:-docker}"
pg_major="${PG_MAJOR:-18}"
root="$(cd "$(dirname "$0")/../.." && pwd)"
sdk_version="${AWS_SDK_S3_VERSION:-$(node -p "require('$root/package.json').dependencies['@aws-sdk/client-s3'].replace(/^[~^]/, '')")}"

fail() { echo "BACKUP_IMAGE_SMOKE: $1" >&2; exit 1; }
run() { "$docker_bin" run --rm --network none "$image" "$@"; }

uid="$(run id -u)" || fail 'nie można uruchomić obrazu (id -u).'
[ "$uid" != '0' ] || fail 'obraz działa jako root — wymagany użytkownik bez uprawnień.'
user="$(run id -un)" || fail 'nie można odczytać użytkownika.'
[ "$user" = 'node' ] || fail "nieoczekiwany użytkownik: $user (oczekiwany node)."

node_version="$(run node --version)" || fail 'brak node.'
[[ "$node_version" == v22.* ]] || fail "node $node_version — oczekiwany v22."

for bin in pg_dump pg_restore psql; do
  version="$(run "$bin" --version)" || fail "brak $bin."
  [[ "$version" =~ \(PostgreSQL\)\ ${pg_major}(\.|$) ]] || fail "$bin: $version — oczekiwany PostgreSQL ${pg_major}."
done

! run sh -c 'command -v npm || command -v npx || command -v yarn' >/dev/null 2>&1 \
  || fail 'obraz zawiera menedżer pakietów (npm/npx/yarn) — niepotrzebny w czasie działania.'

age_version="$(run age --version)" || fail 'brak age.'
[ -n "$age_version" ] || fail 'age nie podał wersji.'

sdk_found="$(run node --input-type=module -e "await import('@aws-sdk/client-s3'); const { readFileSync } = await import('node:fs'); console.log(JSON.parse(readFileSync('/app/node_modules/@aws-sdk/client-s3/package.json', 'utf8')).version);")" \
  || fail 'import @aws-sdk/client-s3 nieudany.'
[ "$sdk_found" = "$sdk_version" ] || fail "@aws-sdk/client-s3 $sdk_found — oczekiwana $sdk_version (package.json)."

# Start bez konfiguracji: kontrolowany kod 2, bez wycieku wartości zmiennych.
canary='postgres://smoke:kanarek-751@db.invalid/x'
set +e
output="$("$docker_bin" run --rm --network none -e BACKUP_SOURCE_URL="$canary" -e BACKUP_DIR= "$image" 2>&1)"
code=$?
set -e
[ "$code" -eq 2 ] || fail "start bez konfiguracji zakończył się kodem $code (oczekiwany 2)."
[[ "$output" == *'Ustaw BACKUP_DIR'* ]] || fail 'start bez konfiguracji bez komunikatu o brakującej zmiennej.'
[[ "$output" != *'kanarek-751'* ]] || fail 'start bez konfiguracji wypisał wartość zmiennej.'

echo "BACKUP_IMAGE_SMOKE: ok (uid $uid, node $node_version, PostgreSQL $pg_major, age $age_version, @aws-sdk/client-s3 $sdk_found)"
