#!/usr/bin/env python3
"""
Kontury znaku „pracuj.be” z DM Sans dla ikon, faviconu i obrazu OG (#7).

Prototyp „Ludzie i praca” rysuje logo krojem DM Sans 800 (opsz 9 — plik „DM Sans 9pt”
z Google Fonts): `.people .logo` = światło −1,5 px przy 29 px, sufiks `.be` = biały na
czerwonym kafelku, światło −.055em (people.css, extended.css). Grafiki rastrowe i SVG
nie mogą polegać na foncie zainstalowanym w systemie (Arial w dawnych ikonach), więc
zapisujemy kontury glifów: każde słowo jako jedna ścieżka SVG w jednostkach em
(y w dół, linia bazowa = 0), ze światłem dodanym po KAŻDYM znaku jak w CSS.

Wejście: assets/fonts/DMSans-4.004[opsz,wght].ttf (SIL OFL 1.1, assets/fonts/DMSans-OFL.txt).
Wyjście: assets/brand/logo-glyphs.json — czyta je scripts/generate-icons.mjs.

Odtworzenie (Python 3 + pip install fonttools==4.66.0):
    python3 scripts/brand-glyphs.py && node scripts/generate-icons.mjs
"""

import json
from pathlib import Path

from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / "assets" / "fonts" / "DMSans-4.004[opsz,wght].ttf"
TARGET = ROOT / "assets" / "brand" / "logo-glyphs.json"

# Oś wagi i kroju optycznego jak w prototypie (font-weight 800, opsz 9).
AXES = {"wght": 800, "opsz": 9}
# Światło z prototypu: −1,5 px / 29 px dla słowa, −.055em dla sufiksu.
WORDS = {"pracuj": -1.5 / 29, ".be": -0.055}


def fmt(value: float) -> str:
    text = f"{value:.4f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


def word_path(font: TTFont, text: str, tracking: float) -> dict:
    upem = font["head"].unitsPerEm
    glyph_set = font.getGlyphSet()
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    pen = SVGPathPen(glyph_set, ntos=fmt)
    x = 0.0
    for char in text:
        name = cmap[ord(char)]
        # Jednostki fontu → em, oś y odwrócona (SVG rośnie w dół).
        glyph_set[name].draw(TransformPen(pen, (1 / upem, 0, 0, -1 / upem, x, 0)))
        x += hmtx[name][0] / upem + tracking
    return {"d": pen.getCommands(), "width": round(x, 4)}


def main() -> None:
    font = instantiateVariableFont(TTFont(SOURCE), AXES)
    upem = font["head"].unitsPerEm
    hhea = font["hhea"]
    data = {
        "source": "DM Sans 4.004 (SIL OFL 1.1), wght 800, opsz 9",
        "ascent": hhea.ascent / upem,
        "descent": -hhea.descent / upem,
        "words": {text: word_path(font, text, tracking) for text, tracking in WORDS.items()},
    }
    TARGET.parent.mkdir(parents=True, exist_ok=True)
    TARGET.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"wrote {TARGET.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
