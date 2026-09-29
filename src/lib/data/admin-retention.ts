/**
 * Warstwa danych panelu administratora — przegląd retencji danych (#486/#574,
 * `/admin/ustawienia/retencja`). TYLKO ODCZYT.
 *
 * Jak `@/lib/data/admin-age-policy`: funkcja sama potwierdza rolę admina (`requireAdmin`) PRZED
 * otwarciem transakcji service-role — `public.retention_policies` nie ma grantów dla
 * `authenticated` (0105). Pokazuje okresy zapisane w bazie (0105/0127/0132), kto i kiedy je
 * ostatnio zmienił (`audit_logs`, akcja `retention.policy_changed` — ten sam wpis co w
 * `/admin/dziennik`) oraz tryby zadań w cronie `/api/maintenance` odczytane z env
 * (`RETENTION_MODE`, `DSA_RETENTION_MODE`, `STORAGE_GC_MODE`) — te same funkcje, których używa
 * cron, więc panel nie może pokazać innego stanu niż ten, który wykonuje harmonogram.
 *
 * Strona NIE zmienia okresów ani trybów (decyzja administratora danych, #574). Bez konfiguracji
 * bazy — dane DEMO równe wartościom z migracji 0127/0132 (Invariant #12).
 */

import 'server-only';

import { dsaRetentionMode, type DsaRetentionMode } from '@/lib/admin/dsa-retention-mode';
import { requireAdmin } from '@/lib/data/admin';
import { isPortalDataConfigured, withServiceRole } from '@/lib/db/portal';
import { queryRows } from '@/lib/db/sql';
import { captureError } from '@/lib/error-report';
import { retentionMode, type RetentionMode } from '@/lib/retention/mode';
import { storageGcDryRun } from '@/lib/storage-gc';

export const RETENTION_ENFORCEMENTS = ['job', 'monitoring', 'infrastructure', 'none'] as const;
export type RetentionEnforcement = (typeof RETENTION_ENFORCEMENTS)[number];

export interface RetentionPolicyChange {
  createdAt: string;
  actorName: string | null;
  beforeDays: number | null;
  afterDays: number | null;
}

export interface RetentionPolicyRow {
  key: string;
  /** Okres w dniach; `null` = zadanie wyłączone do decyzji administratora danych. */
  periodDays: number | null;
  warningDays: number | null;
  enforcement: RetentionEnforcement;
  updatedAt: string | null;
  updatedByName: string | null;
  lastChange: RetentionPolicyChange | null;
}

export interface RetentionModes {
  retention: RetentionMode;
  dsaRetention: DsaRetentionMode;
  storageGc: 'dry-run' | 'delete';
}

export type RetentionOverviewResult =
  | { status: 'ok'; demo: boolean; policies: RetentionPolicyRow[]; modes: RetentionModes }
  | { status: 'error' };

/** Tryby zadań z env — te same funkcje co `/api/maintenance`. */
export function readRetentionModes(env: Record<string, string | undefined> = process.env): RetentionModes {
  return {
    retention: retentionMode(env.RETENTION_MODE),
    dsaRetention: dsaRetentionMode(env.DSA_RETENTION_MODE),
    storageGc: storageGcDryRun(env) ? 'dry-run' : 'delete',
  };
}

/** Wartości z migracji 0127 (+ 0132, sesje i tokeny konta z 0185 i rejestr usunięć z 0105) — tryb DEMO. */
const DEMO_POLICIES: ReadonlyArray<[string, number | null, number | null, RetentionEnforcement]> = [
  ['acceptance_ip_user_agent', 7, null, 'job'],
  ['audit_log', 365, null, 'none'],
  ['closed_application', 180, null, 'job'],
  ['confirmed_guest_request', 30, null, 'job'],
  ['consent_evidence', 1095, null, 'none'],
  ['data_rights_request_log', 1095, null, 'job'],
  ['database_backup', 14, null, 'infrastructure'],
  ['deleted_file', 7, null, 'job'],
  ['deleted_profile', 7, null, 'job'],
  ['erasure_tombstone', null, null, 'job'],
  ['expired_auth_session', 7, null, 'job'],
  ['expired_auth_verification', 7, null, 'job'],
  ['guest_ip_user_agent', 7, null, 'job'],
  ['inactive_candidate_account', 730, 30, 'job'],
  ['inactive_candidate_cv', 365, 30, 'job'],
  ['inactive_searchable_profile', 180, null, 'job'],
  ['security_log', 30, null, 'infrastructure'],
  ['storage_physical_deletion', 3, 1, 'monitoring'],
  ['unconfirmed_guest_request', 7, null, 'job'],
];

function demoPolicies(): RetentionPolicyRow[] {
  return DEMO_POLICIES.map(([key, periodDays, warningDays, enforcement]) => ({
    key,
    periodDays,
    warningDays,
    enforcement,
    updatedAt: null,
    updatedByName: null,
    lastChange: null,
  }));
}

function asNullableString(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Liczba dni z wartości SQL (liczba albo tekst `numeric`); inna wartość → `null`. */
export function asDays(value: unknown): number | null {
  const num = typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(num) ? Math.round(num) : null;
}

function asEnforcement(value: unknown): RetentionEnforcement {
  return (RETENTION_ENFORCEMENTS as readonly string[]).includes(value as string)
    ? (value as RetentionEnforcement)
    : 'none';
}

function fullName(first: unknown, last: unknown, email: unknown): string | null {
  const name = [asNullableString(first), asNullableString(last)].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : asNullableString(email);
}

/** Okresy retencji + ostatnia zmiana każdego z dziennika + tryby crona. Tylko admin. */
export async function getRetentionOverview(): Promise<RetentionOverviewResult> {
  const modes = readRetentionModes();
  if (!isPortalDataConfigured()) return { status: 'ok', demo: true, policies: demoPolicies(), modes };
  await requireAdmin();

  try {
    const { policies, changes } = await withServiceRole(async (tx) => {
      const policies = await queryRows(
        tx,
        'admin.retention-policies',
        `SELECT rp.key,
                round(extract(epoch FROM rp.period) / 86400) AS period_days,
                round(extract(epoch FROM rp.warning_period) / 86400) AS warning_days,
                rp.enforcement,
                rp.updated_at,
                p.first_name, p.last_name, p.email
           FROM public.retention_policies rp
           LEFT JOIN public.profiles p ON p.id = rp.updated_by
          ORDER BY rp.key`,
      );
      const changes = await queryRows(
        tx,
        'admin.retention-last-changes',
        `SELECT DISTINCT ON (a.after_data->>'key')
                a.after_data->>'key' AS key,
                a.before_data->>'days' AS before_days,
                a.after_data->>'days' AS after_days,
                a.created_at,
                p.first_name, p.last_name, p.email
           FROM public.audit_logs a
           LEFT JOIN public.profiles p ON p.id = a.actor_id
          WHERE a.entity_type = 'retention_policy' AND a.action = 'retention.policy_changed'
          ORDER BY a.after_data->>'key', a.created_at DESC, a.id DESC`,
      );
      return { policies, changes };
    });

    const changeByKey = new Map<string, RetentionPolicyChange>();
    for (const row of changes) {
      const key = asNullableString(row['key']);
      if (!key) continue;
      changeByKey.set(key, {
        createdAt: asNullableString(row['created_at']) ?? '',
        actorName: fullName(row['first_name'], row['last_name'], row['email']),
        beforeDays: asDays(row['before_days']),
        afterDays: asDays(row['after_days']),
      });
    }

    return {
      status: 'ok',
      demo: false,
      modes,
      policies: policies.map((row) => {
        const key = String(row['key']);
        return {
          key,
          periodDays: asDays(row['period_days']),
          warningDays: asDays(row['warning_days']),
          enforcement: asEnforcement(row['enforcement']),
          updatedAt: asNullableString(row['updated_at']),
          updatedByName: fullName(row['first_name'], row['last_name'], row['email']),
          lastChange: changeByKey.get(key) ?? null,
        };
      }),
    };
  } catch (error) {
    captureError(error, { area: 'adminRetention.overview' });
    return { status: 'error' };
  }
}
