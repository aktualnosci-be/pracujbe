import { getTranslations } from 'next-intl/server';

import { EYEBROW, H1_EXTENDED, P_EXTENDED } from '@/components/dashboard/panel-styles';
import { NotificationsList } from '@/components/dashboard/NotificationsList';
import { NotificationsLoadError } from '@/components/dashboard/NotificationsLoadError';
import { getNotificationsPage, type DemoRole } from '@/lib/data/notifications';
import { cn } from '@/lib/utils';

/**
 * Ekran pełnej listy powiadomień (#148) — wspólny dla paneli kandydata i pracodawcy.
 * Guard, NOINDEX i chrome dziedziczone z layoutu panelu; odczyt pod sesją/RLS
 * (`getNotificationsPage`), bez env dane DEMO dla roli panelu.
 */
export async function NotificationsScreen({
  locale,
  role,
  unreadOnly,
}: {
  locale: string;
  role: DemoRole;
  unreadOnly: boolean;
}): Promise<React.JSX.Element> {
  const t = await getTranslations({ locale, namespace: 'notifications' });
  const td = await getTranslations({ locale, namespace: 'dashboard' });
  const result = await getNotificationsPage(locale, { unreadOnly, demoRole: role });

  return (
    <div className="min-w-0">
      <header className="min-w-0">
        <p className={EYEBROW}>{role === 'employer' ? td('employerRole') : td('candidatePlaceEyebrow')}</p>
        <h1 className={H1_EXTENDED}>{t('title')}</h1>
        <p className={cn(P_EXTENDED, 'mb-[25px] mt-2 max-w-2xl break-words')}>{t('listIntro')}</p>
      </header>
      {result.status === 'error' ? (
        <NotificationsLoadError />
      ) : (
        <NotificationsList
          key={unreadOnly ? 'unread' : 'all'}
          locale={locale}
          basePath={`/${role}/powiadomienia`}
          initialPage={result.page}
          unreadOnly={unreadOnly}
        />
      )}
    </div>
  );
}
