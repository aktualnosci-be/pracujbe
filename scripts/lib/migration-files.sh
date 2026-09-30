# shellcheck shell=bash
# =============================================================================
# scripts/lib/migration-files.sh — lista plików migracji dla skryptów testów SQL (#1114, TQ2-10).
#
# Źródłowane przez test-rls.sh, test-seed.sh, db/test-backup.sh, db/test-restore.sh
# i db/search-benchmark.sh. Reguły = produkcyjny loader (`scripts/db/migration-files.mjs`
# + `production-migrations.mjs`): KAŻDY plik `.sql` (bez względu na wielkość liter
# rozszerzenia) w podanych katalogach musi mieć nazwę `NNNN_[a-z0-9_]+.sql`, numer nie może się
# powtórzyć (także między katalogami), a kolejność = numer. Dawny wzorzec `0*.sql` pomijał
# migracje od `1000_` wzwyż, więc CI testowało inny zestaw niż ten, który się wdraża.
#
# Czysty bash (job „rls” uruchamia skrypty w kontenerze postgres:16, bez Node).
# Strażnik: tests/unit/migration-files-sh.test.ts (z kontrolami ujemnymi).
# =============================================================================

# migration_files KATALOG... — wypisuje ścieżki (po jednej w wierszu) w kolejności migratora.
# Kod != 0 i komunikat na stderr przy nieprawidłowej nazwie, powtórzonym numerze, braku katalogu
# albo braku migracji. Wołaj przez podstawienie polecenia (`x="$(migration_files …)"`), żeby
# `set -e` zatrzymał skrypt przy błędzie.
migration_files() {
  local dir file name prefix
  local -a rows=()
  local -A seen=()
  for dir in "$@"; do
    if [ ! -d "$dir" ]; then
      echo "migration_files: brak katalogu migracji: $dir" >&2
      return 1
    fi
    for file in "$dir"/*; do
      [ -e "$file" ] || continue
      name="${file##*/}"
      case "${name,,}" in
        *.sql) ;;
        *) continue ;;
      esac
      if [[ ! "$name" =~ ^[0-9]{4}_[a-z0-9_]+\.sql$ ]]; then
        echo "migration_files: nieprawidłowa nazwa migracji SQL: $name" >&2
        return 1
      fi
      if [ -L "$file" ] || [ ! -f "$file" ]; then
        echo "migration_files: migracja musi być zwykłym plikiem: $name" >&2
        return 1
      fi
      prefix="${name:0:4}"
      if [ -n "${seen[$prefix]:-}" ]; then
        echo "migration_files: powtórzony numer migracji: $prefix" >&2
        return 1
      fi
      seen[$prefix]=1
      rows+=("$name"$'\t'"$file")
    done
  done
  if [ "${#rows[@]}" -eq 0 ]; then
    echo "migration_files: brak migracji SQL" >&2
    return 1
  fi
  printf '%s\n' "${rows[@]}" | LC_ALL=C sort | cut -f2
}
