'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { BTN_PRIMARY, P_EXTENDED, PAPER } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

/** Błąd odczytu listy powiadomień (#148): bez technikaliów, ponowienie odświeża trasę. */
export function NotificationsLoadError(): React.JSX.Element {
  const t = useTranslations('notifications');
  const router = useRouter();
  return (
    <section role="alert" className={PAPER}>
      <p className={P_EXTENDED}>{t('loadError')}</p>
      <button type="button" onClick={() => router.refresh()} className={cn(BTN_PRIMARY, 'mt-5')}>
        {t('retry')}
      </button>
    </section>
  );
}
