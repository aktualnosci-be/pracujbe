import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GuestConfirmPanel } from '@/components/public/GuestConfirmPanel';

/**
 * Potwierdzenie jednorazowej aplikacji bez konta (#98) — cel linku z e-maila
 * `guestApplicationConfirm`. Strona niczego nie zmienia przy otwarciu (GET); potwierdza
 * dopiero przycisk. noindex (layout auth) i bez nagłówka Referer (token jest w adresie).
 */
export const dynamic = 'force-dynamic';

type PageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<{ token?: string | string[] }>;
};

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guestApply' });
  return { title: t('confirmTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function GuestConfirmPage({ params, searchParams }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const { token } = await searchParams;
  const t = await getTranslations('guestApply');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">{t('confirmTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <GuestConfirmPanel token={typeof token === 'string' ? token : ''} />
      </CardContent>
    </Card>
  );
}
