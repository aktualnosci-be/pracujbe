import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from './LocaleSwitcher';
import { CookieSettingsButton } from './CookieSettingsButton';

/**
 * Stopka (server component).
 * Kolumny linków wg namespace `footer`, znak marki z tagline'em, ponowne otwarcie ustawień
 * cookies oraz przełącznik języka. Teksty wyłącznie z i18n (footer + common.appName).
 */
export async function Footer() {
  const [t, tCommon] = await Promise.all([
    getTranslations('footer'),
    getTranslations('common'),
  ]);

  const columns = [
    {
      title: t('forCandidates'),
      links: [
        { href: '/oferty-pracy', label: t('jobs') },
      ],
    },
    {
      title: t('forEmployers'),
      links: [
        { href: '/rejestracja-pracodawca', label: t('postJob') },
      ],
    },
    {
      title: t('company'),
      links: [
        { href: '/about', label: t('about') },
        { href: '/faq', label: t('faq') },
        { href: '/contact', label: t('contact') },
      ],
    },
  ] as const;

  const linkClass = 'text-sm text-muted-foreground transition-colors hover:text-foreground';
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-border bg-soft">
      <div className="container py-12">
        <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-5">
          <div className="space-y-3 lg:col-span-2">
            <Logo />
            <p className="max-w-xs text-sm text-muted-foreground">{t('tagline')}</p>
          </div>

          {columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h2 className="text-sm font-semibold text-foreground">{column.title}</h2>
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
            <h2 className="text-sm font-semibold text-foreground">{t('legal')}</h2>
            <ul className="mt-3 space-y-2">
              <li>
                <Link href="/terms" className={linkClass}>
                  {t('terms')}
                </Link>
              </li>
              <li>
                <Link href="/privacy" className={linkClass}>
                  {t('privacy')}
                </Link>
              </li>
              <li>
                <Link href="/cookie-policy" className={linkClass}>
                  {t('cookiePolicy')}
                </Link>
              </li>
              <li>
                <CookieSettingsButton className={linkClass} />
              </li>
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-4 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
          <p className="text-sm text-muted-foreground">
            © {year} {tCommon('appName')}. {t('rights')}
          </p>
          <LocaleSwitcher />
        </div>
      </div>
    </footer>
  );
}
