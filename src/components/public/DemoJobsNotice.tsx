import * as React from 'react';
import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { cn } from '@/lib/utils';

/**
 * Trwały baner „dane przykładowe” (#297, Invariant #12) na stronach z ofertami, gdy serwis
 * pokazuje zestaw demonstracyjny. Odwiedzający nie może uznać fikcyjnych ofert za realne.
 * Strona decyduje o wyświetleniu (`isShowingDemoJobs()` lub `job.isDemo`). Wygląd jak
 * `.people .notice` z prototypu (biała karta, zaokrąglenie 16 px) z ostrzegawczym obrysem.
 */
export async function DemoJobsNotice({ className }: { className?: string }): Promise<React.JSX.Element> {
  const t = await getTranslations('jobs');
  return (
    <aside
      data-testid="demo-jobs-notice"
      aria-label={t('demoNoticeTitle')}
      className={cn(
        'flex items-start gap-3 rounded-2xl border border-warning/40 bg-background p-4 text-sm text-foreground sm:px-5',
        className,
      )}
    >
      <Info className="mt-0.5 h-5 w-5 shrink-0 text-warning-text" aria-hidden="true" />
      <div className="min-w-0">
        <p className="font-semibold">{t('demoNoticeTitle')}</p>
        <p className="mt-1 text-muted-foreground">{t('demoNoticeBody')}</p>
      </div>
    </aside>
  );
}
