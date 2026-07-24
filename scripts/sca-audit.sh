#!/usr/bin/env bash
# =============================================================================
# scripts/sca-audit.sh — Software Composition Analysis (audyt CI-08).
#
# Bramka SCA: blokuje CI, gdy w drzewie zależności są PRAWDZIWE podatności o
# severity high/critical. Audyt liczony z package-lock.json (`--package-lock-only`),
# co daje deterministyczne drzewo i omija błąd „Invalid package tree" pojawiający
# się przy audycie rozpakowanego artefaktu node_modules.
#
# Odporność na flaky endpoint: publiczny endpoint audytu npm bywa niestabilny i
# jest wygaszany („This endpoint is being retired") — potrafi zwrócić 400/5xx.
# `npm audit` kończy się kodem 1 ZARÓWNO przy wykryciu podatności, JAK I przy
# błędzie endpointu, więc nie polegamy na kodzie wyjścia — parsujemy JSON i
# blokujemy WYŁĄCZNIE, gdy realnie policzono high+critical > 0. Błąd/pusty wynik
# endpointu → ostrzeżenie (nie blokujemy CI na fladze infrastruktury npm).
# =============================================================================
set -uo pipefail

audit_json="$(npm audit --json --package-lock-only 2>/dev/null || true)"

if [ -z "$audit_json" ]; then
  echo "::warning::npm audit zwrócił pusty wynik (prawdopodobnie błąd/wygaszony endpoint npm) — pomijam bramkę SCA."
  exit 0
fi

counts="$(printf '%s' "$audit_json" | node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d)).on("end", () => {
    try {
      const j = JSON.parse(s);
      const v = (j.metadata && j.metadata.vulnerabilities) || null;
      if (!v) { console.log("NOMETA"); return; }
      console.log(`${v.high || 0} ${v.critical || 0}`);
    } catch (e) {
      console.log("PARSE_ERR");
    }
  });
')"

if [ "$counts" = "PARSE_ERR" ] || [ "$counts" = "NOMETA" ]; then
  echo "::warning::Nie udało się odczytać wyniku npm audit ($counts) — pomijam bramkę SCA (nie blokuję na fladze endpointu)."
  exit 0
fi

high="${counts%% *}"
critical="${counts##* }"
total=$(( high + critical ))

echo "SCA: podatności high=${high}, critical=${critical}."

if [ "$total" -gt 0 ]; then
  echo "::error::Wykryto ${total} podatności o severity high/critical — bramka SCA blokuje CI."
  # Czytelny raport w logu (kod wyjścia ignorowany — raport pomocniczy).
  npm audit --audit-level=high --package-lock-only || true
  exit 1
fi

echo "SCA OK — brak podatności high/critical."
