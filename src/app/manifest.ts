import type { MetadataRoute } from 'next';

/**
 * Web App Manifest (PWA) generowany przez Next (App Router).
 * Serwowany pod /manifest.webmanifest. Middleware i18n go pomija (ścieżka z kropką),
 * więc nie dostaje prefiksu locale.
 *
 * Ikony są generowane z zatwierdzonego czerwonego kafelka `.be`; instrukcja: public/ICONS_README.md.
 * Kolory zgodne z design tokens: theme #D92932 (primary), background #FFFFFF.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Pracuj.be',
    short_name: 'Pracuj.be',
    description: 'Oferty pracy w Belgii — dla pracowników i pracodawców, w wielu językach.',
    start_url: '/pl',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: 'pl',
    dir: 'ltr',
    background_color: '#FFFFFF',
    theme_color: '#D92932',
    categories: ['business', 'productivity'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'maskable',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
