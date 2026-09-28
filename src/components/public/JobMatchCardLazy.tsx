'use client';

import dynamic from 'next/dynamic';

/**
 * `JobMatchCard` jako osobny chunk (#1130, budżet JS szczegółu oferty #395). Karta dopasowania
 * renderuje się wyłącznie w trybie `RECRUITMENT` (#1131) — w trybie ogłoszeniowym (domyślnym)
 * przeglądarka nie pobiera jej kodu. Bez SSR treści: karta i tak ładuje dane po stronie klienta.
 */
export const JobMatchCardLazy = dynamic(
  () => import('@/components/public/JobMatchCard').then((m) => m.JobMatchCard),
  { ssr: false },
);
