# Ikony PWA, favicon i Open Graph marki Pracuj.be

Statyczne zasoby w `public/` (serwowane z roota, np. `/icon-192.png`). Źródłem jest znak
z prototypu „Ludzie i praca” (`docs/design/people-passport/prototype`, `.people .logo` +
`.people .logo .suffix` w people.css/extended.css): czarne „pracuj” i biały „.be” na czerwonym
kafelku `#D92932`, DM Sans 800 (opsz 9), światło −1,5 px / 29 px, kafelek z odstępem .09em,
dopełnieniem .1/.17/.14em i promieniem .22em, światło sufiksu −.055em.

Odtworzenie (dwa kroki, wynik deterministyczny):

```bash
pip install fonttools==4.66.0
python3 scripts/brand-glyphs.py     # kontury glifów DM Sans → assets/brand/logo-glyphs.json
node scripts/generate-icons.mjs     # icon.svg, ikony PNG i og.png (sharp)
```

Glify są konturami (bez `<text>`), więc ikony nie zależą od fontu zainstalowanego w systemie.
Porównanie z logo prototypu wyrenderowanym w Chromium (ten sam plik fontu, 140 px): kafelek
w tym samym miejscu co do 0,01 px, różnice pikseli tylko na krawędziach antyaliasingu.

| Plik                            | Rozmiar  | `purpose`  | Opis                                                            |
| ------------------------------- | -------- | ---------- | --------------------------------------------------------------- |
| `icon.svg`                      | wektor   | favicon    | Kafelek `.be` (bok = szerokość kafelka z logo), promień .22em.  |
| `icon-32.png`                   | 32×32    | favicon    | Jak `icon.svg`.                                                 |
| `icon-192.png`, `icon-512.png`  | 192, 512 | `any`      | Jak `icon.svg`, przezroczyste rogi.                             |
| `icon-maskable-192/512.png`     | 192, 512 | `maskable` | Pełne czerwone tło, `.be` w strefie bezpiecznej (koło 80%).     |
| `apple-touch-icon.png`          | 180×180  | —          | Pełne tło bez przezroczystości (iOS sam zaokrągla rogi).        |
| `og.png`                        | 1200×630 | Open Graph | Cały znak „pracuj.be” na białym tle, bez tekstu (wspólny dla PL/NL/FR/EN). |

Manifesty `/{locale}/manifest.webmanifest` (generator `src/lib/pwa/manifest.ts`) mają
`theme_color` = czerwień marki `#D92932` (`--pp-red`) i `background_color` = biel.
Strażnik: `tests/unit/brand-assets.test.ts` (rozmiary, kontury zamiast tekstu, tylko czerwień i biel).
