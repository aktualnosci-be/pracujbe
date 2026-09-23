#!/bin/sh
# użycie: pos-neg.sh "<spec>" "<pliki do cofnięcia w kontroli ujemnej...>"
cd /workspace/wt/auth
L=/tmp/claude-0/-workspace-pracujbe/27ac77b3-7ae4-53c9-8e96-07974b43b582/scratchpad; S=$L/audit/auth-candidate
SPEC="$1"; shift
flock $L/locks/build.lock npm run build > $S/build.log 2>&1; echo build=$?
WT=/workspace/wt/auth PORT=3201 npx playwright test --config /workspace/wt/pw.config.mjs $SPEC < /dev/null 2>&1 | grep -E "passed|failed" ; sh $S/stop.sh
mkdir -p $S/neg; rm -rf $S/neg/*
for f in "$@"; do mkdir -p "$S/neg/$(dirname "$f")"; cp "$f" "$S/neg/$f"; git show "origin/main:$f" > "$f"; done
flock $L/locks/build.lock npm run build > $S/build.log 2>&1; echo negbuild=$?
WT=/workspace/wt/auth PORT=3201 npx playwright test --config /workspace/wt/pw.config.mjs $SPEC < /dev/null 2>&1 | grep -E "passed|failed" ; sh $S/stop.sh
for f in "$@"; do cp "$S/neg/$f" "$f"; done
git status --short
