import { getRequestConfig } from 'next-intl/server';
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
    messages: (await import(`../messages/${locale}.json`)).default,
  };
});
