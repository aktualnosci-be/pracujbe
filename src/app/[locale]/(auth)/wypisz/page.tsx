import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { MailX } from 'lucide-react';

import { Link } from '@/i18n/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { UnsubscribeForm } from '@/components/email/UnsubscribeForm';
import { inspectUnsubscribeToken } from '@/lib/email/unsubscribe';

/**
 * Wypisanie z e-maili (#45) — strona z linku w stopce wiadomości (`?t=<podpisany token>`).
 *
 * GET tylko weryfikuje token i pokazuje przycisk potwierdzenia; preferencję zmienia dopiero
 * wysłanie formularza (skanery linków w poczcie nie wypisują odbiorcy). Klient poczty
 * wypisuje jednym kliknięciem przez `POST /api/email/unsubscribe` (RFC 8058).
 * Strona noindex (layout `(auth)` + jawnie tutaj), dynamiczna (parametr zapytania).
 */

export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ t?: string | string[] }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'emailUnsubscribe' });
  return {
    title: t('metaTitle'),
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function UnsubscribePage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { t: rawToken } = await searchParams;
  const token = typeof rawToken === 'string' ? rawToken : '';

  const t = await getTranslations({ locale, namespace: 'emailUnsubscribe' });
  const check = inspectUnsubscribeToken(token);

  let description: string;
  let body: React.ReactNode = null;
  let title = t('title');

  if (check.status === 'valid') {
    const category = t(`category.${check.category}`);
    description = t('confirmText', { category });
    body = (
      <UnsubscribeForm
        token={token}
        locale={locale}
        labels={{
          confirmButton: t('confirmButton'),
          allButton: t('allButton'),
          allDoneText: t('allDoneText'),
          pending: t('pending'),
          doneTitle: t('doneTitle'),
          doneText: t('doneText', { category }),
          errorText: t('errorText'),
          invalidText: t('invalidText'),
          expiredText: t('expiredText'),
          unavailableText: t('unavailableText'),
        }}
      />
    );
  } else if (check.status === 'expired') {
    title = t('expiredTitle');
    description = t('expiredText');
  } else if (check.status === 'unavailable') {
    description = t('unavailableText');
  } else {
    title = t('invalidTitle');
    description = t('invalidText');
  }

  return (
    <div className="py-6">
      <Card>
        <CardHeader className="items-center space-y-3 text-center">
          <span
            className="flex h-14 w-14 items-center justify-center rounded-full bg-primary/10 text-primary"
            aria-hidden="true"
          >
            <MailX className="h-7 w-7" />
          </span>
          <CardTitle as="h1" className="text-2xl">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-center text-sm">
          {body}
          <p className="text-muted-foreground">{t('settingsHint')}</p>
          <Link
            href="/logowanie"
            className="font-medium text-primary underline-offset-4 hover:underline"
          >
            {t('loginLink')}
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
