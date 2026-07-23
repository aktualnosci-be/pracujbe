import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { LocaleSwitcher } from './LocaleSwitcher';
import { CookieSettingsButton } from './CookieSettingsButton';

/**
 * Stopka (server component) — granatowa, wg makiety 01-home.
 *
 * Tło `--primary` (granat), tekst jasny. Znak marki renderowany jako wordmark (biały
 * „Pracuj" + akcentowe „.be") — komponent `Logo` ma granatowy znak, więc byłby niewidoczny
 * na granatowym tle. Kolumny linków wg namespace `footer`, ponowne otwarcie ustawień cookies
 * oraz przełącznik języka. Teksty wyłącznie z i18n (footer + common.appName).
 */
export async function Footer() {
  const [t, tCommon] = await Promise.all([
    getTranslations('footer'),
    getTranslations('common'),
  ]);

  const columns = [
    {
      title: t('forCandidates'),
      links: [{ href: '/oferty-pracy', label: t('jobs') }],
    },
    {
      title: t('forEmployers'),
      links: [{ href: '/rejestracja-pracodawca', label: t('postJob') }],
    },
    {
      title: t('company'),
      links: [
        { href: '/o-nas', label: t('about') },
        { href: '/faq', label: t('faq') },
        { href: '/kontakt', label: t('contact') },
      ],
    },
  ] as const;

  const linkClass =
    'text-sm text-primary-foreground/70 transition-colors hover:text-primary-foreground';
  const headingClass = 'text-sm font-semibold text-primary-foreground';
  const year = new Date().getFullYear();

  return (
    <footer className="bg-primary text-primary-foreground">
      <div className="container py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            <Link href="/" className="inline-flex rounded-sm" aria-label={tCommon('appName')}>
              <span className="text-lg font-bold tracking-tight text-primary-foreground">
                Pracuj<span className="text-accent">.be</span>
              </span>
            </Link>
            <p className="max-w-xs text-sm text-primary-foreground/70">{t('tagline')}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className={headingClass}>{column.title}</h2>
              <ul className="mt-3 space-y-2">
                {column.links.map((item) => (
                  <li key={item.href}>
                    <Link href={item.href} className={linkClass}>
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}

          <nav aria-label={t('legal')}>
            <h2 className={headingClass}>{t('legal')}</h2>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/regulamin" className={linkClass}>
                  {t('terms')}
                </Link>
              </li>
              <li>
                <Link href="/polityka-prywatnosci" className={linkClass}>
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link href="/polityka-cookies" className={linkClass}>
                  {t('cookiePolicy')}
                </Link>
              </li>
              <li>
                <CookieSettingsButton className={linkClass} />
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-primary-foreground/10 pt-6 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-primary-foreground/70">
            © {year} {tCommon('appName')}. {t('rights')}
          </p>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  );
}
