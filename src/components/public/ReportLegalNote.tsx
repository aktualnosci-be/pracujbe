import { getTranslations } from 'next-intl/server';

import { cn } from '@/lib/utils';

/**
 * Miejsce na informację prawną o rozpatrywaniu zgłoszeń (#41). Treść prawną (podstawa,
 * zasady rozpatrywania, środki odwoławcze) uzupełnia właściciel serwisu po zatwierdzeniu mapy
 * obowiązków DSA (#40) — tu celowo tylko neutralny, jawny znacznik „do uzupełnienia”.
 */
export async function ReportLegalNote({ className }: { className?: string }) {
  const t = await getTranslations('contentReport');
  return (
    <p className={cn('rounded-md border border-dashed border-border bg-soft p-3 text-sm text-muted-foreground', className)}>
      {t('legalPlaceholder')}
    </p>
  );
}
