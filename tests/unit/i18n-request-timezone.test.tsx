import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useFormatter } from 'next-intl';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { APP_TIME_ZONE } from '@/lib/datetime';

/**
 * #1085: konfiguracja next-intl ustawia strefę produktu globalnie. Serwer (Railway) działa
 * w UTC, więc bez `timeZone` `format.dateTime` (komponenty serwerowe i klienckie, których
 * provider dziedziczy strefę z serwera) pokazywałby czas UTC — godziny historii statusów
 * przesunięte o 1–2 h, a blisko północy inny dzień.
 */

// getRequestConfig zwraca swój argument — wywołujemy go wprost.
vi.mock('next-intl/server', () => ({
  getRequestConfig: (fn: unknown) => fn,
}));

afterEach(cleanup);

const ISO = '2026-09-26T22:30:00Z'; // 00:30 27.09 w Brukseli (CEST)

function Stamp() {
  const format = useFormatter();
  return (
    <span data-testid="stamp">
      {format.dateTime(new Date(ISO), { dateStyle: 'medium', timeStyle: 'short' })}
    </span>
  );
}

describe('src/i18n/request.ts', () => {
  it('zwraca timeZone = Europe/Brussels dla każdego języka', async () => {
    const mod = (await import('@/i18n/request')) as unknown as {
      default: (args: { requestLocale: Promise<string> }) => Promise<{ timeZone?: string; locale: string }>;
    };
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const cfg = await mod.default({ requestLocale: Promise.resolve(locale) });
      expect(cfg.locale).toBe(locale);
      expect(cfg.timeZone).toBe('Europe/Brussels');
    }
  });

  it('layout [locale] przekazuje strefę także do NextIntlClientProvider', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/[locale]/layout.tsx'), 'utf8');
    expect(src).toMatch(/<NextIntlClientProvider[^>]*timeZone=\{APP_TIME_ZONE\}/);
  });
});

describe('format.dateTime pod providerem', () => {
  it('ze strefą produktu pokazuje godzinę i dzień brukselski', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={{}} timeZone={APP_TIME_ZONE}>
        <Stamp />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('stamp').textContent).toContain('27 wrz 2026');
    expect(screen.getByTestId('stamp').textContent).toContain('00:30');
  });

  it('kontrola ujemna: provider z UTC (stan sprzed naprawy) pokazuje dzień 26 i 22:30', () => {
    render(
      <NextIntlClientProvider locale="pl" messages={{}} timeZone="UTC">
        <Stamp />
      </NextIntlClientProvider>,
    );
    expect(screen.getByTestId('stamp').textContent).toContain('26 wrz 2026');
    expect(screen.getByTestId('stamp').textContent).toContain('22:30');
  });
});
