'use client';

import { useRouter } from '@/i18n/navigation';
import { BTN_PRIMARY, PANEL, PANEL_H2 } from '@/components/dashboard/panel-styles';
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
    <section role="alert" className={cn(PANEL, 'space-y-3', className)}>
      {title ? <h2 className={PANEL_H2}>{title}</h2> : null}
      <p className="text-[15px] text-foreground">{message}</p>
      <button type="button" className={BTN_PRIMARY} onClick={() => router.refresh()}>
        {retryLabel}
      </button>
    </section>
  );
}
