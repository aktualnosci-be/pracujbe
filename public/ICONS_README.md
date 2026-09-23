# Ikony PWA i Open Graph marki Pracuj.be

Te pliki są **statycznymi assetami** i muszą trafić do katalogu `public/` (serwowane z roota, np. `/icon-192.png`).
Generujemy je z zatwierdzonego znaku: biały `.be` na czerwonym kafelku `#D92932`.
Pliki można odtworzyć poleceniem `node scripts/generate-icons.mjs` (zależność `sharp`).

## Wymagane pliki (referencjonowane przez `src/app/manifest.ts`)

| Plik                          | Rozmiar   | `purpose`  | Uwagi                                                                 |
| ----------------------------- | --------- | ---------- | -------------------------------------------------------------------- |
| `public/icon-192.png`         | 192×192   | `any`      | Standardowa ikona PWA. Pełny znak, przezroczyste lub białe tło.      |
| `public/icon-512.png`         | 512×512   | `any`      | Duża ikona PWA (splash / instalacja).                                |
| `public/icon-maskable-192.png`| 192×192   | `maskable` | Maskable: znak w bezpiecznej strefie ~80% (min. 10% marginesu z każdej strony), tło pełne `#2563EB` lub `#FFFFFF`. Bez przezroczystości. |
| `public/icon-maskable-512.png`| 512×512   | `maskable` | Jw., większy rozmiar.                                                |

> Zasada maskable: system może przyciąć ikonę do koła/rombu. Trzymaj istotną treść wewnątrz
> okręgu bezpiecznego (safe zone ≈ 80% szerokości), resztę wypełnij jednolitym tłem.

## Favicon i ikony platformowe (zalecane — dopina je layout/metadata inny agent)

| Plik                          | Rozmiar   | Uwagi                                                                 |
| ----------------------------- | --------- | -------------------------------------------------------------------- |
| `public/favicon.ico`          | 16/32/48  | Multi-rozmiarowy ICO. Klasyczny favicon dla starszych przeglądarek.  |
| `public/icon.svg`             | wektor    | Skalowalny favicon (nowoczesne przeglądarki), respektuje dark mode.  |
| `public/apple-touch-icon.png` | 180×180   | Ekran główny iOS. Bez przezroczystości, tło pełne, bez zaokrągleń (iOS zaokrągla sam). |
| `public/favicon-32.png`       | 32×32     | Opcjonalny PNG favicon.                                              |
| `public/favicon-16.png`       | 16×16     | Opcjonalny PNG favicon.                                              |

## Wskazówki generowania

- Format: PNG 24-bit z kanałem alfa dla `any`; PNG bez przezroczystości (pełne tło) dla `maskable` i `apple-touch-icon`.
- Kolory zgodne z design tokens: primary `#D92932`, tło `#FFFFFF` (patrz `tailwind.config.ts`).
- Eksportuj z jednego źródła wektorowego, żeby wszystkie rozmiary były ostre.
- Weryfikacja maskable: https://maskable.app/ (podgląd przycięć).
- Po dodaniu plików sprawdź manifesty `/{locale}/manifest.webmanifest` (generator `src/lib/pwa/manifest.ts`; stary `/manifest.webmanifest` pozostaje dla PL) —
  wszystkie `src` muszą wskazywać istniejące pliki, inaczej instalacja PWA zgłosi błąd ikon.
