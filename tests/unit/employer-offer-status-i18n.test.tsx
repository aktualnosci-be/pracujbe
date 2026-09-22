import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it } from 'vitest';

import { StatusPill } from '@/components/ui/status-pill';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

afterEach(cleanup);

describe('wygasła oferta w czterech językach', () => {
  for (const [locale, messages, label] of [
    ['pl', pl, 'Wygasła'],
    ['nl', nl, 'Verlopen'],
    ['fr', fr, 'Expirée'],
    ['en', en, 'Expired'],
  ] as const) {
    it(locale, () => {
      render(
        <NextIntlClientProvider locale={locale} messages={messages} timeZone="Europe/Brussels">
          <StatusPill status="expired" />
        </NextIntlClientProvider>,
      );
      expect(screen.getByText(label)).toBeVisible();
    });
  }
});
