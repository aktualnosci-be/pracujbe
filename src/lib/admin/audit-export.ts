/**
 * Eksport dziennika zdarzeń (`/admin/dziennik`) do CSV/JSON — formatowanie bez dostępu do bazy.
 *
 * Kolumny = to, co pokazuje lista: czas, akcja, obiekt (typ, id, etykieta), zmiana statusu,
 * uzasadnienie, aktor jako nazwa albo „System”. Bez e-maili i identyfikatorów aktorów ponad to,
 * co widać w panelu (nazwa aktora bez imienia i nazwiska = e-mail, jak na liście). Czas
 * w Europe/Brussels z przesunięciem (`2026-09-25T14:03:00+02:00`) — jednoznaczny w arkuszu.
 * Komórki CSV przez `csvCell` (RFC 4180 + neutralizacja formuł `= + - @`).
 */
import { csvCell } from '@/lib/admin/breach';
import { APP_TIME_ZONE } from '@/lib/datetime';

export interface AuditExportRow {
  id: string;
  action: string;
  entityType: string | null;
  entityId: string | null;
  entityLabel: string | null;
  statusBefore: string | null;
  statusAfter: string | null;
  reason: string | null;
  actorId: string | null;
  actorName: string | null;
  createdAt: string | null;
}

export interface AuditExportFilters {
  entity: string | null;
  action: string | null;
  id: string | null;
  actor: string | null;
  from: string | null;
  to: string | null;
}

/** Wartość kolumny aktora dla wpisów bez aktora (trigger/usługa). */
export const AUDIT_EXPORT_SYSTEM_ACTOR = 'System';

export const AUDIT_EXPORT_COLUMNS = [
  'created_at',
  'action',
  'entity_type',
  'entity_id',
  'entity_label',
  'status_before',
  'status_after',
  'reason',
  'actor',
] as const;

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO UTC → lokalny czas Europe/Brussels z przesunięciem; zła wartość → ''. */
export function toBrusselsIso(iso: string | null | undefined): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: APP_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const y = get('year');
  const mo = get('month');
  const d = get('day');
  const h = get('hour');
  const mi = get('minute');
  const s = get('second');
  const wholeSeconds = Math.floor(date.getTime() / 1000) * 1000;
  const offsetMin = Math.round((Date.UTC(y, mo - 1, d, h, mi, s) - wholeSeconds) / 60000);
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  return `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

/** Aktor jak na liście: nazwa, „System” (brak aktora) albo pusto (profil nieznany/usunięty). */
export function auditExportActor(row: Pick<AuditExportRow, 'actorId' | 'actorName'>): string {
  if (!row.actorId) return AUDIT_EXPORT_SYSTEM_ACTOR;
  return row.actorName ?? '';
}

function toRecord(row: AuditExportRow): Record<(typeof AUDIT_EXPORT_COLUMNS)[number], string | null> {
  return {
    created_at: toBrusselsIso(row.createdAt),
    action: row.action,
    entity_type: row.entityType,
    entity_id: row.entityId,
    entity_label: row.entityLabel,
    status_before: row.statusBefore,
    status_after: row.statusAfter,
    reason: row.reason,
    actor: auditExportActor(row),
  };
}

/**
 * CSV (separator `,`, CRLF). Przy obcięciu ostatni wiersz `#truncated,<limit>` — informacja
 * widoczna też w samym pliku (nagłówek HTTP `X-Export-Truncated` dla interfejsu).
 */
export function auditExportCsv(rows: AuditExportRow[], meta: { truncated: boolean; limit: number }): string {
  const lines = [AUDIT_EXPORT_COLUMNS.join(',')];
  for (const row of rows) {
    const record = toRecord(row);
    lines.push(AUDIT_EXPORT_COLUMNS.map((column) => csvCell(record[column])).join(','));
  }
  if (meta.truncated) lines.push(`#truncated,${meta.limit}`);
  return `${lines.join('\r\n')}\r\n`;
}

/** JSON: metadane eksportu (filtry, strefa, limit, obcięcie) + wiersze z kolumnami jak CSV. */
export function auditExportJson(
  rows: AuditExportRow[],
  meta: { truncated: boolean; limit: number; filters: AuditExportFilters; exportedAt: Date },
): string {
  return `${JSON.stringify(
    {
      exportedAt: toBrusselsIso(meta.exportedAt.toISOString()),
      timeZone: APP_TIME_ZONE,
      filters: meta.filters,
      limit: meta.limit,
      rowCount: rows.length,
      truncated: meta.truncated,
      rows: rows.map(toRecord),
    },
    null,
    2,
  )}\n`;
}
