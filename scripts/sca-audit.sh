#!/usr/bin/env bash
# =============================================================================
# scripts/sca-audit.sh — Software Composition Analysis (audyt CI-08).
#
# Bramka SCA: blokuje CI, gdy w drzewie zależności są PRAWDZIWE podatności o
# severity high/critical. Audyt liczony z package-lock.json (`--package-lock-only`),
# co daje deterministyczne drzewo i omija błąd „Invalid package tree" pojawiający
# się przy audycie rozpakowanego artefaktu node_modules.
#
# Decyzja #607: trzy różne wyniki, nie dwa. Publiczny endpoint audytu npm bywa
# niestabilny/wygaszany i potrafi zwrócić puste ciało, HTML błędu albo JSON bez
# `metadata.vulnerabilities`. Wcześniej KAŻDY z tych przypadków kończył się kodem 0
# z samym ostrzeżeniem — bramka bezpieczeństwa była zielona bez żadnego dowodu.
# Teraz `scripts/lib/sca-audit-outcome.mjs` klasyfikuje wynik na:
#   - clean/vulnerable        — audyt policzony, mamy liczby (dowód);
#   - recognized_transient    — jawnie rozpoznana awaria przejściowa dostawcy
#                                 (sieć: ENOTFOUND/ETIMEDOUT/…, HTML zamiast JSON,
#                                 albo ustrukturyzowane `error` samego npm) — po
#                                 kontrolowanych ponowieniach NIE blokujemy CI,
#                                 ale zostaje to w logu jako jawnie opisana decyzja;
#   - unrecognized            — pusty/niepoprawny/pozbawiony metadanych wynik BEZ
#                                 rozpoznanej przyczyny → BLOKUJEMY CI (brak dowodu
#                                 braku podatności to nie to samo, co brak podatności).
# Retry tylko dla `recognized_transient` (sieć/infrastruktura może się same naprawić
# w kilka sekund); `unrecognized` nie jest ponawiane — nic nie wskazuje, że kolejna
# próba coś wyjaśni, a ponawianie pustego wyniku zjadałoby tylko minuty CI.
# =============================================================================
set -uo pipefail

# Nadpisywalne tylko przez testy integracyjne skryptu (retry bez realnego czekania).
MAX_ATTEMPTS="${SCA_AUDIT_MAX_ATTEMPTS:-3}"
RETRY_DELAY_SECONDS="${SCA_AUDIT_RETRY_DELAY_SECONDS:-4}"

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
stdout_file="$(mktemp)"
stderr_file="$(mktemp)"
trap 'rm -f "$stdout_file" "$stderr_file"' EXIT

attempt=1
outcome_json=""
status=""

while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  npm audit --json --package-lock-only >"$stdout_file" 2>"$stderr_file" || true
  outcome_json="$(node "$script_dir/lib/sca-audit-outcome.mjs" "$stdout_file" "$stderr_file")"
  status="$(printf '%s' "$outcome_json" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).status))')"

  if [ "$status" != "recognized_transient" ]; then
    break
  fi

  reason="$(printf '%s' "$outcome_json" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).reason))')"
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "::warning::Próba ${attempt}/${MAX_ATTEMPTS} audytu: rozpoznana przejściowa awaria (${reason}) — ponawiam za ${RETRY_DELAY_SECONDS}s."
    sleep "$RETRY_DELAY_SECONDS"
  fi
  attempt=$((attempt + 1))
done

case "$status" in
  clean)
    echo "SCA OK — brak podatności high/critical."
    exit 0
    ;;
  vulnerable)
    high="$(printf '%s' "$outcome_json" | node -e 'process.stdin.on("data",d=>process.stdout.write(String(JSON.parse(d).high)))')"
    critical="$(printf '%s' "$outcome_json" | node -e 'process.stdin.on("data",d=>process.stdout.write(String(JSON.parse(d).critical)))')"
    total=$((high + critical))
    echo "SCA: podatności high=${high}, critical=${critical}."
    echo "::error::Wykryto ${total} podatności o severity high/critical — bramka SCA blokuje CI."
    npm audit --audit-level=high --package-lock-only || true
    exit 1
    ;;
  recognized_transient)
    reason="$(printf '%s' "$outcome_json" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).reason))')"
    echo "::warning::Rozpoznana przejściowa awaria dostawcy audytu po ${MAX_ATTEMPTS} próbach (${reason}) — DECYZJA: nie blokuję CI na fladze infrastruktury npm, ale wynik audytu jest NIEZNANY dla tego przebiegu. Uruchom ponownie później albo sprawdź ręcznie (npm audit --package-lock-only)."
    exit 0
    ;;
  unrecognized|*)
    reason="$(printf '%s' "$outcome_json" | node -e 'process.stdin.on("data",d=>process.stdout.write(JSON.parse(d).reason))')"
    echo "::error::Wynik npm audit jest pusty/nieczytelny i przyczyna NIE jest jawnie rozpoznaną awarią przejściową (${reason}) — bramka SCA blokuje CI (brak dowodu braku podatności high/critical)."
    exit 1
    ;;
esac
