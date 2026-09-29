import { notFound } from 'next/navigation';

import { AppError, ErrorCodes } from '@/lib/errors';

/**
 * Tryb produktu (#1128, #1136) — decyzja produktowa: portal ogłoszeniowy.
 *
 * Jedno źródło trybu dla wszystkich wyłączeń funkcji rekrutacyjnych (akcje serwera, strony,
 * routing, cron, e-maile). Zmienna `PORTAL_LEGAL_MODE`:
 * - `RECRUITMENT` (bez rozróżniania wielkości liter, białe znaki na brzegach pomijane) — funkcje
 *   rekrutacyjne działają;
 * - KAŻDA inna wartość, także brak zmiennej, pusta, `true`, `1`, literówka — tryb ogłoszeniowy
 *   `CLASSIFIEDS_ONLY` (fail-closed: pomyłka w konfiguracji nie włącza rekrutacji).
 *
 * Ta sama reguła wszędzie: produkcja, demo, lokalny dev, Vitest i E2E. Testy istniejących
 * przepływów rekrutacyjnych ustawiają `RECRUITMENT` jawnie (Vitest: `tests/helpers/portal-mode.ts`,
 * Playwright: `env` serwera w `playwright*.config.ts`).
 *
 * Moduł bez `server-only` i `node:*`: działa w middleware/edge
 * i w kodzie serwera. W bundlu przeglądarki zmienna nie istnieje (nie ma prefiksu
 * `NEXT_PUBLIC_`), więc klient zawsze widzi tryb ogłoszeniowy — komponent kliencki dostaje tryb
 * od serwera w propsach, a nie liczy go sam. Odczyt leniwy (`process.env` przy wywołaniu), więc
 * build nie utrwala wartości.
 *
 * Stan w bazie (dwuklucz env + baza) dochodzi w #1140/#1143; wtedy tryb efektywny = iloczyn
 * obu kluczy, a ten moduł pozostaje kluczem środowiskowym.
 */
export const PORTAL_LEGAL_MODE_ENV = 'PORTAL_LEGAL_MODE';

export const PORTAL_LEGAL_MODES = ['CLASSIFIEDS_ONLY', 'RECRUITMENT'] as const;
export type PortalLegalMode = (typeof PORTAL_LEGAL_MODES)[number];

/**
 * Funkcje rekrutacyjne wyłączane w trybie ogłoszeniowym. Dziś wszystkie zależą od jednego trybu;
 * lista pozwala strażnikowi CI (`tests/legal/classifieds-only.test.ts`) sprawdzać pokrycie.
 */
export const RECRUITMENT_FEATURES = [
  'applications',
  'guestApply',
  'offers',
  'screening',
  'matching',
  'candidateSearch',
  'messaging',
  'cvAccess',
  'cvImport',
] as const;
export type RecruitmentFeature = (typeof RECRUITMENT_FEATURES)[number];

/** `RECRUITMENT` wyłącznie przy dokładnej wartości włączającej; w każdym innym przypadku tryb ogłoszeniowy. */
export function portalLegalMode(): PortalLegalMode {
  const raw = (process.env[PORTAL_LEGAL_MODE_ENV] ?? '').trim().toUpperCase();
  return raw === 'RECRUITMENT' ? 'RECRUITMENT' : 'CLASSIFIEDS_ONLY';
}

/**
 * Czy funkcja rekrutacyjna działa. Argument `feature` jest dziś informacyjny (jeden tryb dla
 * wszystkich funkcji), ale wywołania z kluczem pozwalają później rozdzielić włączanie per funkcja
 * bez zmiany miejsc wywołań.
 */
export function isRecruitmentEnabled(feature?: RecruitmentFeature): boolean {
  void feature;
  return portalLegalMode() === 'RECRUITMENT';
}

/** Server actions / route handlers: rzuca `AppError(RECRUITMENT_DISABLED)` w trybie ogłoszeniowym. */
export function assertRecruitmentEnabled(feature?: RecruitmentFeature): void {
  if (!isRecruitmentEnabled(feature)) {
    throw new AppError(ErrorCodes.RECRUITMENT_DISABLED, feature ? { context: { feature } } : undefined);
  }
}

/** Strony i layouty funkcji rekrutacyjnych: w trybie ogłoszeniowym 404 (`notFound()`). */
export function notFoundUnlessRecruitment(feature?: RecruitmentFeature): void {
  if (!isRecruitmentEnabled(feature)) notFound();
}
