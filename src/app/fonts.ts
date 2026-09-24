import localFont from 'next/font/local';

/**
 * Font Inter (zmienna CSS --font-inter, mapowana w tailwind.config.ts na font-sans).
 *
 * SELF-HOSTED OFFLINE: używamy `next/font/local` z plikiem dołączonym do repo
 * (`src/app/fonts/`), zamiast `next/font/google` — build nie wymaga sieci do Google Fonts.
 *
 * PODZBIÓR (#388): `InterVariable-latin.woff2` (~73 KB zamiast 344 KB) powstaje skryptem
 * `scripts/subset-font.py` z oryginału `assets/fonts/InterVariable-4.001.woff2`: tylko znaki
 * pl/nl/fr/en (Latin, Latin-1, Latin Extended-A, interpunkcja typograficzna, €, ™, strzałki)
 * i oś wagi zawężona do 400–700 (kod używa font-normal/medium/semibold/bold). Nie podmieniaj
 * pliku ręcznie — zmień skrypt i uruchom go ponownie. Strażnik: tests/unit/font-subset.test.ts.
 *
 * FALLBACK (#388): zamiast domyślnego `local("Arial")` z next/font (Arial nie ma na Androidzie
 * ani Linuksie, więc tam metryki nie działały i podmiana fontu przesuwała układ) mamy własne
 * fonty zastępcze z dopasowanymi metrykami — @font-face „Inter Fallback …” w globals.css,
 * wartości ze `scripts/font-fallback-metrics.py`. Kolejność: grupa Arial (Windows, macOS,
 * Linux z Liberation Sans) → Roboto (Android) → DejaVu Sans (pozostały Linux).
 *
 * Zdefiniowany w osobnym module (nie w layout.tsx), ponieważ pliki route (layout/page)
 * mogą eksportować wyłącznie zarezerwowane pola Next.js. Importowany na <html> w [locale]/layout.
 */
export const inter = localFont({
  src: './fonts/InterVariable-latin.woff2',
  variable: '--font-inter',
  display: 'swap',
  weight: '400 700',
  style: 'normal',
  adjustFontFallback: false,
  fallback: [
    'Inter Fallback Arial',
    'Inter Fallback Roboto',
    'Inter Fallback DejaVu',
    'system-ui',
    'sans-serif',
  ],
});
