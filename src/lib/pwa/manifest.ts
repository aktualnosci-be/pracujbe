import type { MetadataRoute } from 'next';
import type { Locale } from '@/i18n/routing';

/** Jeden zestaw zasobów i jedna tożsamość instalacji PWA dla wszystkich języków. */
export function createManifest(
  locale: Locale,
  name: string,
  description: string,
): MetadataRoute.Manifest {
  return {
    // Przed tą zmianą nie było `id`, więc przeglądarka używała /pl (stary start_url).
    // Jedno stałe ID zachowuje tożsamość instalacji także po zmianie języka.
    id: '/pl',
    name,
    short_name: name,
    description,
    start_url: `/${locale}`,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    lang: locale,
    dir: 'ltr',
    background_color: '#FFFFFF',
    theme_color: '#D92932',
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
