import { getTranslations } from 'next-intl/server';

import { Link } from '@/i18n/navigation';
import { Logo } from '@/components/brand/Logo';
import { LocaleSwitcher } from './LocaleSwitcher';
import { MobileNav, PrimaryNav } from './MobileNav';

/**
 * Górny pasek nawigacji (server component) — kalka `.people .nav` z prototypu „Ludzie i praca”
 * (klasy `.pp-nav*` w globals.css): logo 29 px, pogrubione czarne linki, po prawej kod języka,
 * „Zaloguj się” i czarny przycisk „Dodaj ofertę” (cel jak dotąd: konto pracodawcy).
 *
 * ≤ 850 px (jak prototyp): bez linków nawigacji i przycisku; konto jako „pigułka”. Odstępstwo:
 * zostaje przycisk menu (nawigacja, logowanie, dodanie oferty i język są dostępne z telefonu).
 * Teksty wyłącznie z i18n (namespace `nav`).
 *
 * `locale` przychodzi jawnie z layoutu (#298): bez niego next-intl sięga po `headers()`,
 * co przełącza całe drzewo stron publicznych na renderowanie dynamiczne.
 */
export async function Header({ locale }: { locale: string }) {
  const t = await getTranslations({ locale, namespace: 'nav' });

  return (
    <header className="pp-nav sticky top-0 z-40 w-full">
      <Link href="/" className="min-w-0 rounded-sm">
        <Logo className="text-[29px] font-extrabold max-[600px]:text-[26px]" />
      </Link>
      <PrimaryNav className="pp-navlinks" linkClassName="pp-navlink" />

      <div className="pp-account">
        <div className="pp-lang-wrap pp-lang">
          <LocaleSwitcher variant="compact" />
        </div>
        <Link href="/logowanie" className="pp-navlink">
          {t('login')}
        </Link>
        <Link href="/rejestracja-pracodawca" className="pp-btn pp-btn-ink">
          {t('postJob')}
        </Link>
        <span className="pp-menu">
          <MobileNav />
        </span>
      </div>
    </header>
  );
}
