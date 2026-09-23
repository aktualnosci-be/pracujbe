'use client';

import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';

export function CompanyLoadError(): React.JSX.Element {
  const t = useTranslations('company');
  const tCommon = useTranslations('common');
  const router = useRouter();

  return (
    <section
      role="alert"
      className="rounded-3xl border border-error/30 bg-card p-5 sm:p-7"
    >
      <h2 className="text-xl font-semibold text-foreground">
        {t('loadError')}
      </h2>
      <p className="mt-2 text-base leading-relaxed text-muted-foreground">
        {t('loadErrorHint')}
      </p>
      <Button
        type="button"
        size="lg"
        className="mt-5 min-h-12"
        onClick={() => router.refresh()}
      >
        {tCommon('retry')}
      </Button>
    </section>
  );
}
