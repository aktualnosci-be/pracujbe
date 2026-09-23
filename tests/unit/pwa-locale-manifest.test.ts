import { describe, expect, it } from 'vitest';
import { routing } from '@/i18n/routing';
import { createManifest } from '@/lib/pwa/manifest';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';

const messages = { pl, nl, fr, en };

describe('manifest PWA', () => {
  it.each(routing.locales)('ma język, adres i opis wersji %s', (locale) => {
    const translated = messages[locale];
    const value = createManifest(
      locale,
      translated.common.appName,
      translated.metadata.homeDescription,
    );

    expect(value).toMatchObject({
      id: '/pl',
      name: translated.common.appName,
      description: translated.metadata.homeDescription,
      start_url: `/${locale}`,
      lang: locale,
      scope: '/',
      background_color: '#FFFFFF',
      theme_color: '#D92932',
    });
  });
});
