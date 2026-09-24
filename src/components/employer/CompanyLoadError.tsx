'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { BTN_PRIMARY, NOTICE, NOTICE_TEXT, NOTICE_TITLE } from '@/components/dashboard/panel-styles';
import { cn } from '@/lib/utils';

export function CompanyLoadError(): React.JSX.Element {
  const t = useTranslations('company');
  const tCommon = useTranslations('common');
  const router = useRouter();

  return (
    <section role="alert" className={cn(NOTICE, 'border-error/30 bg-card')}>
      <div className="min-w-0">
        <h2 className={NOTICE_TITLE}>{t('loadError')}</h2>
        <p className={NOTICE_TEXT}>{t('loadErrorHint')}</p>
      </div>
      <Button type="button" className={cn(BTN_PRIMARY, 'h-auto whitespace-normal')} onClick={() => router.refresh()}>
        {tCommon('retry')}
      </Button>
    </section>
  );
}
