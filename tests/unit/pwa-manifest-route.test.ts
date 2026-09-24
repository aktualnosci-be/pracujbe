import { describe, expect, it, vi } from 'vitest';

import { routing } from '@/i18n/routing';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

/**
 * #174 — manifest PWA per język na poziomie trasy (nie tylko generatora): każdy język z
 * `routing.locales` dostaje własne `lang`/`start_url`/opis, nieobsługiwany → 404, a adres
 * manifestu omija middleware (bramka hasła i przekierowania next-intl), tak jak ikony.
 */

type Copy = { common: Record<string, string>; metadata: Record<string, string> };
const MESSAGES: Record<string, Copy> = { pl, nl, fr, en };

vi.mock('next-intl/server', () => ({
  getTranslations: async ({ locale, namespace }: { locale: string; namespace: string }) =>
    (key: string) => MESSAGES[locale]![namespace as keyof Copy][key],
}));

vi.mock('next-intl/middleware', () => ({ default: () => () => new Response(null) }));

const { GET } = await import('@/app/[locale]/manifest.webmanifest/route');
const { config } = await import('@/middleware');

function call(locale: string): Promise<Response> {
  return GET(new Request(`https://pracuj.be/${locale}/manifest.webmanifest`), {
    params: Promise.resolve({ locale }),
  });
}

describe('trasa /{locale}/manifest.webmanifest', () => {
  it('ma tłumaczenia dla każdego języka z routingu (nowy język bez kopiowania generatora)', () => {
    for (const locale of routing.locales) {
      expect(MESSAGES[locale]?.common?.appName, locale).toBeTruthy();
      expect(MESSAGES[locale]?.metadata?.homeDescription, locale).toBeTruthy();
    }
  });

  it.each(routing.locales)('%s: lang, start_url i opis w tym języku', async (locale) => {
    const response = await call(locale);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/manifest+json');
    const manifest = await response.json();
    expect(manifest).toMatchObject({
      id: '/pl',
      lang: locale,
      start_url: `/${locale}`,
      scope: '/',
      name: MESSAGES[locale]!.common.appName,
      description: MESSAGES[locale]!.metadata.homeDescription,
      theme_color: '#D92932',
      background_color: '#FFFFFF',
    });
    expect(manifest.icons).toHaveLength(4);
  });

  it.each(['xx', 'de', 'PL', ''])('nieobsługiwany język %j → 404, bez polskiego manifestu', async (locale) => {
    const response = await call(locale);
    expect(response.status).toBe(404);
    expect(await response.text()).toBe('');
  });

  it('adres manifestu omija middleware (bramka hasła nie zwraca HTML zamiast JSON)', () => {
    const [matcher] = config.matcher;
    const matches = (path: string) => new RegExp(`^${matcher}$`).test(path);
    for (const locale of routing.locales) {
      expect(matches(`/${locale}/manifest.webmanifest`), locale).toBe(false);
      // Kontrola ujemna: strona startowa z manifestu nadal przechodzi przez middleware (bramka, i18n).
      expect(matches(`/${locale}`), locale).toBe(true);
    }
    expect(matches('/manifest.webmanifest')).toBe(false);
  });
});
