import { cn } from '@/lib/utils';
import { StatValue } from '@/components/dashboard/StatValue';
import {
  STAT,
  STAT_LABEL,
  STAT_SMALL,
  STAT_VALUE,
  STATS,
} from '@/components/dashboard/panel-styles';

export interface PanelStat {
  label: string;
  /** `null` = brak danych (nie zero): widoczna kreska + `noDataLabel` dla czytnika ekranu. */
  value: string | number | null;
  sub?: string;
}

/**
 * `.stats` / `.stat` z prototypu „04 Ludzie i praca” — kafelki w jednej ramce: etykieta,
 * duża wartość, podpis. Teksty przychodzą przetłumaczone. Cztery kolumny, ≤ 900 px dwie.
 */
export function PanelStats({
  items,
  className,
  noDataLabel,
}: {
  items: PanelStat[];
  className?: string;
  /** Przetłumaczone „brak danych” — wymagane, gdy któraś wartość może być `null`. */
  noDataLabel?: string;
}) {
  return (
    <div className={cn(STATS, 'grid-cols-4 max-[900px]:grid-cols-2', className)}>
      {items.map((stat) => (
        <div key={stat.label} className={STAT}>
          <p className={STAT_LABEL}>{stat.label}</p>
          <p className={cn(STAT_VALUE, 'tabular-nums')}>
            <StatValue value={stat.value} noDataLabel={noDataLabel} />
          </p>
          {stat.sub ? <p className={STAT_SMALL}>{stat.sub}</p> : null}
        </div>
      ))}
    </div>
  );
}
