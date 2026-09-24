#!/usr/bin/env bash
# Kontrola PR-a na drzewie scalonym z aktualnym origin/main (bez dotykania gałęzi roboczej).
# Użycie: bash scripts/integration/premerge.sh <pełny_head_sha> [dodatkowe ścieżki vitest...]
# Wypisuje TSC_OK / LINT_OK i podsumowanie Vitest; kod 3 = konflikt, 1 = błąd kontroli.
set -euo pipefail

repo=$(git rev-parse --show-toplevel)
head_sha=${1:?Podaj pełny SHA head PR-a}
shift || true
tests=("$@")
[ ${#tests[@]} -eq 0 ] && tests=(tests/unit)

cd "$repo"
git fetch -q origin
git worktree prune
tree=$(git merge-tree --write-tree origin/main "$head_sha") || { echo CONFLICT; exit 3; }
commit=$(git commit-tree "$tree" -p origin/main -m premerge)

work=$(mktemp -d "${TMPDIR:-/tmp}/premerge.XXXXXX")
trap 'cd "$repo"; git worktree remove --force "$work" >/dev/null 2>&1 || true' EXIT
git worktree add -q --detach "$work" "$commit"
cd "$work"
ln -s "$repo/node_modules" node_modules

for locale in pl nl fr en; do
  node -e "JSON.parse(require('fs').readFileSync('src/messages/$locale.json','utf8'))"
done

rc=0
npx tsc --noEmit && echo TSC_OK || rc=1
npx eslint src --quiet >/dev/null && echo LINT_OK || rc=1
npx vitest run "${tests[@]}" 2>&1 | grep -E "Tests |FAIL" || rc=1
exit $rc
