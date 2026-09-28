// @vitest-environment node
import { describe, expect, it } from 'vitest';

import { shouldServeStreamingMetadata } from 'next/dist/server/lib/streaming-metadata';

import config from '../../next.config.mjs';

/**
 * #1032: strona ma tytuł ZAWSZE, także w trakcie `router.refresh()` po akcji serwera.
 * Strumieniowane metadane (domyślne od Next 15.2 dla nie-botów) renderują `<title>` pod
 * Suspense w `<body>`, a drzewo metadanych w ładunku RSC ma klucz z identyfikatorem żądania —
 * odświeżenie montuje je od nowa i dokument chwilowo nie ma tytułu (axe `document-title`).
 * `htmlLimitedBots` dopasowany do każdego user-agenta wyłącza strumieniowanie metadanych.
 */

const BROWSERS = [
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:130.0) Gecko/20100101 Firefox/130.0',
];

describe('metadane blokujące (next.config.mjs, #1032)', () => {
  it('żadna przeglądarka nie dostaje strumieniowanych metadanych', () => {
    expect(config.htmlLimitedBots).toBeInstanceOf(RegExp);
    for (const ua of BROWSERS) {
      expect(shouldServeStreamingMetadata(ua, config.htmlLimitedBots!.source), ua).toBe(false);
    }
  });

  it('kontrola ujemna: domyślna lista Next strumieniuje metadane przeglądarkom', () => {
    for (const ua of BROWSERS) {
      expect(shouldServeStreamingMetadata(ua, undefined), ua).toBe(true);
    }
  });
});
