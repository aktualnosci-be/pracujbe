#!/usr/bin/env python3
"""
Szerokości znaków DM Sans do układu baneru kampanii (#175).

Baner SVG jest składany na serwerze (bez przeglądarki), a font `src/app/fonts/DMSans-latin.woff2`
jest do niego osadzany. Żeby zmierzyć tekst tak, jak narysuje go przeglądarka, zapisujemy
szerokości (advance width, jednostki na 1 em) dla wag 400 i 700 przy opsz 9
(`font-optical-sizing: none` w SVG — jak sekcje `.pp-*`). Kerning pomijamy: w DM Sans pary
kerningu są prawie wyłącznie ujemne, więc pomiar bez niego jest ostrożny (tekst zajmie nie więcej).

Odtworzenie (wymaga: pip install fonttools==4.66.0 brotli==1.2.0):
    python3 scripts/campaign-banner-metrics.py
Wyjście: src/lib/campaign-banner/metrics.generated.ts (strażnik: tests/unit/campaign-banner.test.ts).
"""

import hashlib
import json
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
FONT = ROOT / "src" / "app" / "fonts" / "DMSans-latin.woff2"
TARGET = ROOT / "src" / "lib" / "campaign-banner" / "metrics.generated.ts"


def widths(weight: int) -> tuple[int, dict[int, int]]:
    font = TTFont(FONT)
    instance = instantiateVariableFont(font, {"wght": weight, "opsz": 9})
    upem = instance["head"].unitsPerEm
    hmtx = instance["hmtx"]
    cmap = instance.getBestCmap()
    return upem, {cp: hmtx[name][0] for cp, name in sorted(cmap.items())}


def main() -> None:
    upem, regular = widths(400)
    upem_bold, bold = widths(700)
    assert upem == upem_bold
    digest = hashlib.sha256(FONT.read_bytes()).hexdigest()
    body = (
        "// Wygenerowane przez scripts/campaign-banner-metrics.py — nie edytować ręcznie.\n"
        f"export const FONT_SHA256 = '{digest}';\n"
        f"export const UNITS_PER_EM = {upem};\n"
        f"export const WIDTHS_400: Readonly<Record<number, number>> = {json.dumps(regular, separators=(',', ':'))};\n"
        f"export const WIDTHS_700: Readonly<Record<number, number>> = {json.dumps(bold, separators=(',', ':'))};\n"
    )
    TARGET.write_text(body, encoding="utf-8")
    print(f"{TARGET.relative_to(ROOT)}: {len(regular)} znaków, upem {upem}")


if __name__ == "__main__":
    main()
