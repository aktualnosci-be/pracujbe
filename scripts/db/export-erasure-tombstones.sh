#!/usr/bin/env bash
# =============================================================================
# scripts/db/export-erasure-tombstones.sh — eksport rejestru usunięć (#486).
#
# Zapisuje UUID z public.erasure_tombstones (0105) do pliku, który restore-backup.sh
# przyjmuje jako RESTORE_TOMBSTONES_FILE: po odtworzeniu STARSZEJ kopii osoby usunięte po
# jej wykonaniu są usuwane ponownie (public.apply_erasure_tombstones). Plik zawiera wyłącznie
# identyfikatory (bez e-maili i innych danych), ale nadal są to dane pseudonimowe — prawa
# 0600, przechowywanie obok kopii i poza bazą, którą odtwarzamy.
#
# Format: pierwszy wiersz `pracujbe-erasure-tombstones/1`, dalej jeden UUID w wierszu.
#
# Wejście wyłącznie ze zmiennych środowiskowych:
#   TOMBSTONE_SOURCE_URL — baza, z której czytamy rejestr (np. bieżąca produkcja, tylko odczyt),
#   TOMBSTONE_OUTPUT     — ścieżka pliku wynikowego (nadpisywany atomowo).
# Skrypt nie wypisuje URL-i ani identyfikatorów, tylko ich liczbę.
#
# Kod wyjścia: 0 = zapisano; 1 = błąd; 2 = konfiguracja.
# =============================================================================
set -euo pipefail
umask 077

fail() { echo "TOMBSTONES: $1" >&2; exit "${2:-1}"; }

[ -n "${TOMBSTONE_SOURCE_URL:-}" ] || fail 'Ustaw TOMBSTONE_SOURCE_URL.' 2
[ -n "${TOMBSTONE_OUTPUT:-}" ] || fail 'Ustaw TOMBSTONE_OUTPUT.' 2
command -v psql >/dev/null || fail 'Brak programu psql.' 2
out_dir="$(dirname "$TOMBSTONE_OUTPUT")"
[ -d "$out_dir" ] && [ -w "$out_dir" ] || fail 'Katalog pliku wynikowego nie istnieje lub jest niezapisywalny.' 2

tmp="$(mktemp "$out_dir/.tombstones.XXXXXX")"
trap 'rm -f "$tmp"' EXIT

echo 'pracujbe-erasure-tombstones/1' >"$tmp"
psql -X -q -v ON_ERROR_STOP=1 -At --dbname="$TOMBSTONE_SOURCE_URL" \
  -c 'select subject_id from public.erasure_tombstones order by subject_id' >>"$tmp" 2>/dev/null \
  || fail 'Odczyt rejestru usunięć nie powiódł się.'

count="$(($(wc -l <"$tmp") - 1))"
if tail -n +2 "$tmp" | grep -Evq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
  fail 'Nieoczekiwany format identyfikatora w rejestrze.'
fi
chmod 600 "$tmp"
mv -f "$tmp" "$TOMBSTONE_OUTPUT"
trap - EXIT
echo "TOMBSTONES: PASS — liczba identyfikatorów: ${count}."
