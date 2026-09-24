import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { GuestConfirmPanel } from '@/components/public/GuestConfirmPanel';
import { GuestLinkIntake } from '@/components/public/GuestLinkIntake';
import { readGuestLinkToken } from '@/lib/guest-apply/link-cookie';

/**
 * Potwierdzenie jednorazowej aplikacji bez konta (#98) — cel linku z e-maila
 * `guestApplicationConfirm`. Strona niczego nie zmienia przy otwarciu (GET); potwierdza
 * dopiero przycisk. noindex i Referrer-Policy: no-referrer dla jednorazowego linku.
 */
export const dynamic = 'force-dynamic';

type PageProps = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: 'guestApply' });
  return { title: t('confirmTitle'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

export default async function GuestConfirmPage({ params }: PageProps) {
  const { locale } = await params;
  setRequestLocale(locale);
  const hasToken = Boolean(await readGuestLinkToken('confirm'));
  const t = await getTranslations('guestApply');

  return (
    <Card>
      <CardHeader>
        <CardTitle as="h1" className="text-2xl">{t('confirmTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <GuestLinkIntake locale={locale} purpose="confirm" hasToken={hasToken}>
          <GuestConfirmPanel />
        </GuestLinkIntake>
      </CardContent>
    </Card>
  );
}
