import localFont from 'next/font/local';

/**
 * Font DM Sans (zmienna CSS --font-dm-sans, mapowana w tailwind.config.ts na font-sans) —
 * krój zatwierdzonego prototypu „Ludzie i praca” (docs/design/people-passport, #5/#7).
 *
 * SELF-HOSTED OFFLINE: używamy `next/font/local` z plikiem dołączonym do repo
 * (`src/app/fonts/`), zamiast `next/font/google` — build nie wymaga sieci do Google Fonts.
 *
 * LICENCJA: SIL Open Font License 1.1 (The DM Sans Project Authors) — pełny tekst
 * w `assets/fonts/DMSans-OFL.txt`. OFL pozwala na osadzanie i podzbiór; nazwa zastrzeżona
 * („Reserved Font Name”) nie jest używana dla pliku wynikowego.
 *
 * PODZBIÓR (#388): `DMSans-latin.woff2` (~42 KB zamiast 235 KB TTF) powstaje skryptem
 * `scripts/subset-font.py` z oryginału `assets/fonts/DMSans-4.004[opsz,wght].ttf`: tylko znaki
 * pl/nl/fr/en (Latin, Latin-1, Latin Extended-A, interpunkcja typograficzna, €, ™, strzałki),
 * oś wagi zawężona do 400–800 (font-normal … font-bold oraz 650/750/800 z prototypu), oś opsz
 * 9–40 bez zmian; sekcje w stylu prototypu (`.pp-*`) wyłączają krój optyczny (opsz 9 = plik
 * „DM Sans 9pt”, który prototyp dostaje z Google Fonts). Nie podmieniaj pliku ręcznie — zmień skrypt i uruchom go ponownie.
 * Strażnik: tests/unit/font-subset.test.ts.
 *
 * FALLBACK (#388): zamiast domyślnego `local("Arial")` z next/font (Arial nie ma na Androidzie
 * ani Linuksie, więc tam metryki nie działały i podmiana fontu przesuwała układ) mamy własne
 * fonty zastępcze z dopasowanymi metrykami — @font-face „DM Sans Fallback …” w globals.css,
 * wartości ze `scripts/font-fallback-metrics.py`. Kolejność: grupa Arial (Windows, macOS,
 * Linux z Liberation Sans) → Roboto (Android) → DejaVu Sans (pozostały Linux).
 *
 * Zdefiniowany w osobnym module (nie w layout.tsx), ponieważ pliki route (layout/page)
 * mogą eksportować wyłącznie zarezerwowane pola Next.js. Importowany na <html> w [locale]/layout.
 */
export const dmSans = localFont({
  src: './fonts/DMSans-latin.woff2',
  variable: '--font-dm-sans',
  display: 'swap',
  weight: '400 800',
  style: 'normal',
  adjustFontFallback: false,
  fallback: [
    'DM Sans Fallback Arial',
    'DM Sans Fallback Roboto',
    'DM Sans Fallback DejaVu',
    'system-ui',
    'sans-serif',
  ],
});
