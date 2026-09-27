import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { AUDIT_ACTION_KEY, AUDIT_ENTITY_TYPES } from '@/lib/admin/list-params';
import { getRetentionOverview, readRetentionModes } from '@/lib/data/admin-retention';
import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * Przegląd retencji w panelu admina (#486/#574, `/admin/ustawienia/retencja`) — tylko odczyt.
 *
 * `getRetentionOverview` potwierdza rolę admina (`requireAdmin` → `notFound()`) PRZED odczytem
 * service-role, mapuje `retention_policies` + ostatnią zmianę z `audit_logs` i pokazuje tryby
 * crona z tych samych funkcji co `/api/maintenance`. Lista kategorii DEMO i opisy w
 * `src/messages` muszą pokrywać każdą kategorię wstawioną migracjami (strażnik niżej).
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const ROOT = process.cwd();
const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;

/** Klucze kategorii wstawiane do `retention_policies` przez migracje (wszystkie pliki). */
function migrationRetentionKeys(): string[] {
  const dir = resolve(ROOT, 'supabase', 'migrations');
  const keys = new Set<string>();
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.sql'))) {
    const sql = readFileSync(resolve(dir, file), 'utf-8');
    const re = /insert into public\.retention_policies\b[\s\S]*?\bvalues\b([\s\S]*?)on conflict/gi;
    for (const match of sql.matchAll(re)) {
      for (const row of match[1]!.matchAll(/^\s*\('([a-z_]+)'/gm)) keys.add(row[1]!);
    }
  }
  return [...keys].sort();
}

describe('tryby crona (te same funkcje co /api/maintenance)', () => {
  it('brak zmiennych = wszystko wyłączone / tylko liczniki', () => {
    expect(readRetentionModes({})).toEqual({ retention: 'off', dsaRetention: 'off', storageGc: 'dry-run' });
  });

  it('dokładne wartości włączają tryby', () => {
    expect(
      readRetentionModes({ RETENTION_MODE: 'apply', DSA_RETENTION_MODE: 'dry-run', STORAGE_GC_MODE: 'delete' }),
    ).toEqual({ retention: 'apply', dsaRetention: 'dry-run', storageGc: 'delete' });
  });

  it('KONTROLA UJEMNA: literówka/inna wielkość liter nie włącza usuwania', () => {
    expect(
      readRetentionModes({ RETENTION_MODE: 'APPLY', DSA_RETENTION_MODE: 'true', STORAGE_GC_MODE: 'deletee' }),
    ).toEqual({ retention: 'off', dsaRetention: 'off', storageGc: 'dry-run' });
  });
});

describe('getRetentionOverview', () => {
  it('bez roli admina → notFound przed odczytem service-role', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'employer' });
    await expect(getRetentionOverview()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('bez sesji → notFound przed odczytem service-role', async () => {
    resetFakeDb(null);
    await expect(getRetentionOverview()).rejects.toThrow('NEXT_NOT_FOUND');
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo: kategorie z migracji, bez wywołania bazy', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeSession.configured = false;
    const result = await getRetentionOverview();
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.demo).toBe(true);
    expect(result.policies.map((p) => p.key).sort()).toEqual(migrationRetentionKeys());
    expect(result.policies.find((p) => p.key === 'inactive_candidate_cv')).toMatchObject({
      periodDays: 365,
      warningDays: 30,
      enforcement: 'job',
    });
    expect(result.policies.find((p) => p.key === 'erasure_tombstone')?.periodDays).toBeNull();
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('odczyt: okresy w dniach, aktor zmiany z dziennika, ostatnia zmiana per kategoria', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb
      .rows('admin.retention-policies', [
        {
          key: 'closed_application',
          period_days: '180',
          warning_days: null,
          enforcement: 'job',
          updated_at: '2026-09-25T10:00:00.000Z',
          first_name: 'Anna',
          last_name: 'Admin',
          email: 'anna@example.test',
        },
        {
          key: 'erasure_tombstone',
          period_days: null,
          warning_days: null,
          enforcement: 'unexpected',
          updated_at: '2026-09-20T10:00:00.000Z',
          first_name: null,
          last_name: null,
          email: null,
        },
      ])
      .rows('admin.retention-last-changes', [
        {
          key: 'closed_application',
          before_days: '30',
          after_days: '180',
          created_at: '2026-09-25T10:00:00.000Z',
          first_name: null,
          last_name: null,
          email: 'anna@example.test',
        },
      ]);

    const result = await getRetentionOverview();
    expect(result).toMatchObject({ status: 'ok', demo: false });
    if (result.status !== 'ok') return;
    expect(result.policies).toEqual([
      {
        key: 'closed_application',
        periodDays: 180,
        warningDays: null,
        enforcement: 'job',
        updatedAt: '2026-09-25T10:00:00.000Z',
        updatedByName: 'Anna Admin',
        lastChange: {
          createdAt: '2026-09-25T10:00:00.000Z',
          actorName: 'anna@example.test',
          beforeDays: 30,
          afterDays: 180,
        },
      },
      {
        key: 'erasure_tombstone',
        periodDays: null,
        warningDays: null,
        // Nieznana wartość z bazy nie trafia do UI jako klucz tłumaczenia.
        enforcement: 'none',
        updatedAt: '2026-09-20T10:00:00.000Z',
        updatedByName: null,
        lastChange: null,
      },
    ]);
    // Odczyt tylko service-rolem, bez żadnego zapisu.
    expect(fakeDb.calls.every((c) => c.as === 'service' && c.kind === 'rows')).toBe(true);
    // Zapytanie dziennika zawężone do zmian okresów retencji.
    const [changes] = fakeDb.callsTo('admin.retention-last-changes');
    expect(changes?.text).toContain("a.action = 'retention.policy_changed'");
  });

  it('awaria bazy → status error (bez treści błędu)', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rows('admin.retention-policies', () => {
      throw new Error('connection terminated');
    });
    await expect(getRetentionOverview()).resolves.toEqual({ status: 'error' });
  });
});

describe('strażnik: każda kategoria z migracji ma etykietę i opis w 4 językach', () => {
  const keys = migrationRetentionKeys();

  it('parser migracji znajduje kategorie (kontrola ujemna pustej listy)', () => {
    expect(keys.length).toBeGreaterThanOrEqual(17);
    expect(keys).toContain('acceptance_ip_user_agent');
  });

  for (const locale of LOCALES) {
    it(`${locale}: adminRetention.keys pokrywa kategorie z migracji`, () => {
      const messages = JSON.parse(readFileSync(resolve(ROOT, 'src', 'messages', `${locale}.json`), 'utf-8')) as {
        adminRetention: { keys: Record<string, { label?: string; description?: string }> };
      };
      const defined = messages.adminRetention.keys;
      for (const key of keys) {
        expect(defined[key]?.label, `${locale}: ${key}.label`).toBeTruthy();
        expect(defined[key]?.description, `${locale}: ${key}.description`).toBeTruthy();
      }
      // Bez martwych wpisów: kategoria usunięta z bazy znika też z tłumaczeń.
      expect(Object.keys(defined).sort()).toEqual(keys);
    });
  }
});

describe('dziennik: zmiany retencji mają typ obiektu i etykiety akcji', () => {
  it('retention_policy w filtrach, akcje z 0105/0127 z kluczem i18n', () => {
    expect(AUDIT_ENTITY_TYPES).toContain('retention_policy');
    expect(AUDIT_ACTION_KEY['retention.policy_changed']).toBeTruthy();
    expect(AUDIT_ACTION_KEY['retention.policies_seeded']).toBeTruthy();
  });
});
