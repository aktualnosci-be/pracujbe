import { getRequestConfig } from 'next-intl/server';
import { APP_TIME_ZONE } from '@/lib/datetime';
import { routing } from './routing';

/**
 * Dostarcza wiadomości (tłumaczenia) dla bieżącego żądania po stronie serwera.
 * Wywoływane przez next-intl na podstawie prefiksu locale w URL.
 */
export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const supported: readonly string[] = routing.locales;
  const locale = requested && supported.includes(requested) ? requested : routing.defaultLocale;

  return {
    locale,
    // Serwer (Railway) działa w UTC — bez tego `format.dateTime` w komponentach serwerowych
    // i klienckich (provider dziedziczy strefę z serwera) pokazywałby czas UTC (#1085).
    timeZone: APP_TIME_ZONE,
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
