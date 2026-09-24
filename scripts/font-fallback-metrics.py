#!/usr/bin/env python3
"""
Metryki fontów zastępczych dla DM Sans (#388; font od #5/#7) — wartości `size-adjust` /
`ascent-override` / `descent-override` / `line-gap-override` w src/app/globals.css
(„DM Sans Fallback …”).

Tekst malowany przed dociągnięciem DM Sans (font-display: swap) używa fontu systemowego.
Dopasowane metryki sprawiają, że po podmianie linie mają tę samą wysokość i prawie tę samą
szerokość — bez przesunięć układu (CLS). `next/font` generuje je tylko dla Arial, którego
nie ma na Androidzie i Linuksie, dlatego mamy własne grupy: Arial/Helvetica/Liberation Sans
(metrycznie zgodne), Roboto (Android) i DejaVu Sans (Linux bez Liberation).

Szerokość = średnia szerokość znaku ważona częstością znaków w tekstach UI
(src/messages/*.json, wszystkie języki), dla instancji DM Sans wght 400, opsz 9 (krój stron
publicznych — `.pp-*` z `font-optical-sizing: none` w globals.css).

Użycie (pip install fonttools==4.66.0 brotli==1.2.0):
    python3 scripts/font-fallback-metrics.py NAZWA=plik[,plik2] ...
np.:
    python3 scripts/font-fallback-metrics.py \\
      Arial=arimo-latin-400-normal.woff2,arimo-latin-ext-400-normal.woff2 \\
      Roboto=roboto-latin-400-normal.woff2,roboto-latin-ext-400-normal.woff2 \\
      DejaVu=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
(Arimo/Liberation Sans mają metryki Arial; pliki np. z pakietów npm @fontsource/arimo i
@fontsource/roboto.)
"""

import json
import sys
from collections import Counter
from pathlib import Path

from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
PRIMARY = ROOT / "src" / "app" / "fonts" / "DMSans-latin.woff2"


def ui_text_frequency() -> Counter:
    counts: Counter = Counter()

    def walk(value) -> None:
        if isinstance(value, str):
            counts.update(ch for ch in value if not ch.isspace() or ch == " ")
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    for path in sorted((ROOT / "src" / "messages").glob("*.json")):
        walk(json.loads(path.read_text(encoding="utf-8")))
    return counts


def advances(paths: list[str]) -> tuple[dict[int, float], TTFont]:
    """Szerokości znaków (w jednostkach em) z jednego lub kilku plików jednej rodziny."""
    widths: dict[int, float] = {}
    first = None
    for path in paths:
        font = TTFont(path)
        if "fvar" in font:
            font = instantiateVariableFont(font, {"wght": 400, "opsz": 9})
        first = first or font
        upm = font["head"].unitsPerEm
        hmtx = font["hmtx"]
        for code, glyph in font.getBestCmap().items():
            widths.setdefault(code, hmtx[glyph][0] / upm)
    assert first is not None
    return widths, first


def main() -> None:
    freq = ui_text_frequency()
    primary_widths, primary = advances([str(PRIMARY)])
    upm = primary["head"].unitsPerEm
    hhea = primary["hhea"]
    for arg in sys.argv[1:]:
        name, files = arg.split("=", 1)
        widths, _ = advances(files.split(","))
        common = [c for c in freq if ord(c) in primary_widths and ord(c) in widths]
        total = sum(freq[c] for c in common)
        primary_avg = sum(primary_widths[ord(c)] * freq[c] for c in common) / total
        fallback_avg = sum(widths[ord(c)] * freq[c] for c in common) / total
        size_adjust = primary_avg / fallback_avg
        print(f"/* {name} */")
        print(f"  ascent-override: {hhea.ascent / upm / size_adjust * 100:.2f}%;")
        print(f"  descent-override: {abs(hhea.descent) / upm / size_adjust * 100:.2f}%;")
        print(f"  line-gap-override: {hhea.lineGap / upm / size_adjust * 100:.2f}%;")
        print(f"  size-adjust: {size_adjust * 100:.2f}%;")


if __name__ == "__main__":
    main()
