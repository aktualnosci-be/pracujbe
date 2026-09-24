#!/usr/bin/env python3
"""
Podzbiór fontu DM Sans dla Pracuj.be (#388, font z prototypu „Ludzie i praca” — #5/#7).

Wejście: assets/fonts/DMSans-4.004[opsz,wght].ttf — oryginalny wariant zmienny DM Sans 4.004
(googlefonts/dm-fonts przez google/fonts `ofl/dmsans`, licencja SIL OFL 1.1 — pełny tekst
w assets/fonts/DMSans-OFL.txt; ~235 KB TTF, 486 glifów, osie opsz 9–40 i wght 100–1000).
Wyjście: src/app/fonts/DMSans-latin.woff2 — tylko to, czego potrzebują pl/nl/fr/en.

Co zostaje:
- oś `wght` zawężona do 400–800 (font-normal … font-bold oraz 750/800 nagłówków i logo
  z prototypu);
- oś `opsz` 9–40 bez zmian (automatyczny krój optyczny dla nagłówków);
- znaki: Basic Latin + Latin-1 + Latin Extended-A (ąćęłńóśźż, éèêëàâçîïôûùœ, ĳ),
  ș/ț, akcenty łączone, interpunkcja typograficzna („” ‘’ – — … • « »), €, ™, strzałki,
  znaki matematyczne używane w UI (− ≈ ≠ ≤ ≥), ✓;
- domyślne cechy OpenType + `tnum` (klasa `tabular-nums`) i `case`.

Odtworzenie (wymaga Pythona 3 i: pip install fonttools==4.66.0 brotli==1.2.0):
    python3 scripts/subset-font.py
Strażnik rozmiaru i pokrycia znaków: tests/unit/font-subset.test.ts.
"""

import os
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "fonts" / "DMSans-4.004[opsz,wght].ttf"
TARGET = ROOT / "src" / "app" / "fonts" / "DMSans-latin.woff2"

# Znaki zachowane w podzbiorze (lista sprawdzana w tests/unit/font-subset.test.ts).
UNICODES = [
    *range(0x0020, 0x007F),  # Basic Latin
    *range(0x00A0, 0x0180),  # Latin-1 Supplement + Latin Extended-A
    *range(0x0218, 0x021C),  # ș ț (rumuński — tani, spotykany w nazwiskach)
    *range(0x02C6, 0x02DE),  # znaki modyfikujące (ˆ ˇ ˘ ˙ ˚ ˛ ˜ ˝)
    *range(0x0300, 0x0370),  # akcenty łączone (tekst w NFD)
    *range(0x2000, 0x2070),  # interpunkcja ogólna („” ‘’ – — … • ‹ ›)
    0x20AC,  # €
    0x2122,  # ™
    *range(0x2190, 0x219A),  # strzałki ← ↑ → ↓ ↔ ↕ ...
    0x2212, 0x2248, 0x2260, 0x2264, 0x2265,  # − ≈ ≠ ≤ ≥
    0x2713,  # ✓
    0xFEFF,  # BOM / zero-width no-break space
    0xFFFD,  # znak zastępczy
]

FEATURES = [
    # domyślne cechy fontTools (kern, liga, calt, ccmp, locl, mark, mkmk, ...)
    *subset.Options().layout_features,
    "tnum",
    "case",
]


def ensure_reproducible() -> None:
    """Instancer iteruje po zbiorach — stały PYTHONHASHSEED i znacznik czasu dają ten sam plik."""
    if os.environ.get("PYTHONHASHSEED") == "0" and os.environ.get("SOURCE_DATE_EPOCH") == "0":
        return
    env = {**os.environ, "PYTHONHASHSEED": "0", "SOURCE_DATE_EPOCH": "0"}
    os.execve(sys.executable, [sys.executable, *sys.argv], env)


def main() -> None:
    ensure_reproducible()
    # Najpierw podzbiór glifów, potem zawężenie osi (instancer na pełnym foncie jest wolny).
    font = TTFont(SOURCE, lazy=False)

    options = subset.Options()
    options.flavor = "woff2"
    options.layout_features = FEATURES
    options.name_IDs = ["*"]  # zachowaj pełną tabelę name (licencja OFL, wersja)
    options.name_languages = ["*"]
    options.notdef_outline = True
    options.recalc_bounds = True
    options.drop_tables += ["DSIG"]

    subsetter = subset.Subsetter(options)
    subsetter.populate(unicodes=UNICODES)
    subsetter.subset(font)
    font = instantiateVariableFont(font, {"wght": (400, 800)})

    TARGET.parent.mkdir(parents=True, exist_ok=True)
    font.flavor = "woff2"
    font.save(TARGET)
    print(f"{TARGET.relative_to(ROOT)}: {TARGET.stat().st_size} B, {len(font.getGlyphOrder())} glifów")


if __name__ == "__main__":
    main()
