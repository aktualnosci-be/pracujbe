/**
 * Warstwa danych panelu administratora — próg wieku kandydatów (#492, `/admin/ustawienia`).
 *
 * Jak `@/lib/data/admin`: funkcja sama potwierdza rolę admina (`requireAdmin`) PRZED otwarciem
 * transakcji service-role — `public.age_policy` nie ma grantów dla `authenticated` (migracja
 * 0126), więc odczyt idzie przez service_role, tak jak inne odczyty panelu. Ostatnia zmiana
 * progu pochodzi z dziennika zdarzeń (`audit_logs`, akcja `age_policy.updated`, `entity_type =
 * 'age_policy'`) — ten sam wpis, który widać w `/admin/dziennik`. Bez konfiguracji bazy — dane
 * DEMO zgodne z wartościami startowymi z migracji (Invariant #12).
 */

import 'server-only';

import { CANDIDATE_MIN_AGE_LOWEST, normalizeCandidateMinAge } from '@/lib/age-policy/constants';
import { requireAdmin } from '@/lib/data/admin';
import { isPortalDataConfigured, withServiceRole } from '@/lib/db/portal';
import { queryOne } from '@/lib/db/sql';
import type { TransactionQuery } from '@/lib/db/transaction';
import { captureError } from '@/lib/error-report';

export interface AgePolicyLastChange {
  /** Nazwa (albo e-mail) admina, który dokonał zmiany; brak profilu → `null`. */
  actorName: string | null;
  createdAt: string;
  beforeMinAge: number | null;
  afterMinAge: number;
  beforeConfirmed: boolean | null;
  afterConfirmed: boolean;
  reason: string | null;
  /** Liczba profili kandydatów ukrytych z wyszukiwania tą zmianą (0126). */
  hiddenProfiles: number;
}

export interface AgePolicySettings {
  minAge: number;
  confirmed: boolean;
  reason: string | null;
  updatedAt: string | null;
  updatedByName: string | null;
  lastChange: AgePolicyLastChange | null;
}

export type AgePolicySettingsResult = ({ status: 'ok'; demo: boolean } & AgePolicySettings) | { status: 'error' };

/** Wartości startowe z migracji 0126 (decyzja właściciela 25.09.2026, #576). */
const DEMO_SETTINGS: AgePolicySettings = {
  minAge: CANDIDATE_MIN_AGE_LOWEST,
  confirmed: true,
  reason:
    'Decyzja właściciela 25.09.2026 (#576): konto kandydata od 16 lat, wyszukiwalność tylko 18+.',
  updatedAt: null,
  updatedByName: null,
  lastChange: null,
};

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

function fullName(row: Record<string, unknown> | null): string | null {
  if (!row) return null;
  const first = asNullableString(row['first_name']);
  const last = asNullableString(row['last_name']);
  const name = [first, last].filter(Boolean).join(' ').trim();
  return name.length > 0 ? name : asNullableString(row['email']);
}

async function readProfileName(
  tx: TransactionQuery,
  id: string | null,
): Promise<Record<string, unknown> | null> {
  if (!id) return null;
  return queryOne(
    tx,
    'admin.age-policy-actor',
    'SELECT first_name, last_name, email FROM public.profiles WHERE id = $1',
    [id],
  );
}

/** Odczyt progu konta kandydata + ostatnia zmiana z dziennika. Tylko admin — patrz `requireAdmin`. */
export async function getAgePolicySettings(): Promise<AgePolicySettingsResult> {
  if (!isPortalDataConfigured()) return { status: 'ok', demo: true, ...DEMO_SETTINGS };
  await requireAdmin();

  try {
    const data = await withServiceRole(async (tx) => {
      const policy = await queryOne(
        tx,
        'admin.age-policy',
        'SELECT candidate_min_age, confirmed, reason, updated_at, updated_by FROM public.age_policy WHERE id',
      );
      const updater = await readProfileName(tx, asNullableString(policy?.['updated_by']));
      const change = await queryOne(
        tx,
        'admin.age-policy-last-change',
        `SELECT actor_id, before_data, after_data, created_at
           FROM public.audit_logs
          WHERE entity_type = 'age_policy' AND action = 'age_policy.updated'
          ORDER BY created_at DESC, id DESC
          LIMIT 1`,
      );
      const actor = await readProfileName(tx, asNullableString(change?.['actor_id']));
      return { policy, updater, change, actor };
    });

    const minAge = normalizeCandidateMinAge(data.policy?.['candidate_min_age']);
    const confirmed = data.policy?.['confirmed'] === true;
    const reason = asNullableString(data.policy?.['reason']);
    const updatedAt = asNullableString(data.policy?.['updated_at']);
    const updatedByName = fullName(data.updater);

    let lastChange: AgePolicyLastChange | null = null;
    if (data.change) {
      const before = asRecord(data.change['before_data']);
      const after = asRecord(data.change['after_data']);
      lastChange = {
        actorName: fullName(data.actor),
        createdAt: asNullableString(data.change['created_at']) ?? '',
        beforeMinAge: asNumber(before['candidate_min_age']),
        afterMinAge: normalizeCandidateMinAge(after['candidate_min_age']),
        beforeConfirmed: asBoolean(before['confirmed']),
        afterConfirmed: after['confirmed'] === true,
        reason: asNullableString(after['reason']),
        hiddenProfiles: asNumber(after['hidden_profiles']) ?? 0,
      };
    }

    return { status: 'ok', demo: false, minAge, confirmed, reason, updatedAt, updatedByName, lastChange };
  } catch (error) {
    captureError(error, { area: 'adminAgePolicy.settings' });
    return { status: 'error' };
  }
}
