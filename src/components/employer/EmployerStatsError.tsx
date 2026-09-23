'use client';

import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * Stan błędu odczytu statystyk pracodawcy (kafelki / lejek, #304). Zastępuje sekcję zamiast
 * pokazywać zera — „brak danych" wolno pokazać tylko po udanym odczycie. Ponowienie odświeża
 * bieżącą stronę (RSC), bez technicznych szczegółów bazy (Invariant #8).
 */
export function EmployerStatsError({
  title,
  message,
  retryLabel,
  className,
}: {
  title?: string;
  message: string;
  retryLabel: string;
  className?: string;
}) {
  const router = useRouter();

  return (
    <section role="alert" className={cn('space-y-3 rounded-lg border border-border bg-card p-5', className)}>
      {title ? <h2 className="text-base font-semibold text-foreground">{title}</h2> : null}
      <p className="text-base text-foreground">{message}</p>
      <Button type="button" size="lg" className="min-h-12" onClick={() => router.refresh()}>
        {retryLabel}
      </Button>
    </section>
  );
}
