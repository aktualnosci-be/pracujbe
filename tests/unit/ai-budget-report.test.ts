import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  aiBudgetLevel,
  aiBudgetPercent,
  aiCostReportSchema,
  aiBudgetStatusSchema,
  createUsdFormatter,
  emptyAiCostReport,
  parseAiBudgetStatus,
  parseAiCostReport,
} from '@/lib/admin/ai-costs';
import { evaluateOps, type OpsMetrics } from '@/lib/ops/sensors';

/** #36 — raport kosztów AI (panel admina) i czujki budżetu w /api/health/ops. */

const healthy: OpsMetrics = {
  email: { ready: 0, oldestReadyAgeSeconds: 0, abandonedLeases: 0, failedLast24h: 0 },
  authEmail: null,
  webhooks: { stuckProcessing: 0, failedLast24h: 0 },
  maintenance: { overdueActiveJobs: 0, staleDiscountReservations: 0, staleCheckoutIntents: 0 },
  connections: { used: 1, max: 100, reserved: 3 },
};

const budget = (daySpent: number, monthSpent = daySpent, stale = 0) => ({
  day: { spentMicroUsd: daySpent, limitMicroUsd: 1_000_000 },
  month: { spentMicroUsd: monthSpent, limitMicroUsd: 10_000_000 },
  staleReservations: stale,
});

describe('poziom budżetu', () => {
  it('ok < 80% ≤ ostrzeżenie < 100% ≤ wyczerpany; limit 0 lub brak = wyczerpany', () => {
    expect(aiBudgetLevel({ spentMicroUsd: 799_999, limitMicroUsd: 1_000_000 })).toBe('ok');
    expect(aiBudgetLevel({ spentMicroUsd: 800_000, limitMicroUsd: 1_000_000 })).toBe('warning');
    expect(aiBudgetLevel({ spentMicroUsd: 1_000_000, limitMicroUsd: 1_000_000 })).toBe('exhausted');
    expect(aiBudgetLevel({ spentMicroUsd: 0, limitMicroUsd: 0 })).toBe('exhausted');
    expect(aiBudgetLevel({ spentMicroUsd: 0, limitMicroUsd: null })).toBe('exhausted');
    expect(aiBudgetPercent({ spentMicroUsd: 1_234_000, limitMicroUsd: 10_000_000 })).toBe(12);
    expect(aiBudgetPercent({ spentMicroUsd: 5, limitMicroUsd: 0 })).toBe(100);
  });
});

describe('czujki budżetu AI', () => {
  it('bez pomiaru budżetu — bez sygnałów (zgodność wstecz)', () => {
    expect(evaluateOps(healthy)).toEqual({ status: 'ok', alerts: [], warnings: [] });
  });

  it('wyczerpany limit doby albo miesiąca = alarm (funkcje AI zablokowane)', () => {
    expect(evaluateOps(healthy, null, budget(1_000_000))).toMatchObject({ status: 'alert', alerts: ['ai_budget_exhausted'] });
    expect(evaluateOps(healthy, null, budget(0, 10_000_000))).toMatchObject({ status: 'alert', alerts: ['ai_budget_exhausted'] });
  });

  it('≥ 80% limitu, stare rezerwacje i nieczytelny stan = ostrzeżenia bez alarmu', () => {
    expect(evaluateOps(healthy, null, budget(850_000, 850_000, 2))).toEqual({
      status: 'ok',
      alerts: [],
      warnings: ['ai_budget_near_limit', 'ai_budget_stale_reservation'],
    });
    expect(evaluateOps(healthy, null, null)).toEqual({ status: 'ok', alerts: [], warnings: ['ai_budget_unavailable'] });
  });

  it('zdrowy budżet = brak sygnałów (recovery)', () => {
    expect(evaluateOps(healthy, null, budget(10))).toEqual({ status: 'ok', alerts: [], warnings: [] });
  });
});

describe('raport kosztów', () => {
  const report = {
    status: budget(120_000),
    days: 31,
    daily: [
      { day: '2026-09-25', feature: 'job_listing_import', calls: 3, ok: 2, notOk: 1, open: 0, inputTokens: 9000, outputTokens: 4000, costMicroUsd: 120_000 },
    ],
    monthly: [{ month: '2026-09-01', calls: 3, costMicroUsd: 120_000 }],
  };

  it('parsuje odpowiedź ai_cost_report i odrzuca nieznaną funkcję / ujemne liczby / dodatkowe dane', () => {
    expect(parseAiCostReport(report)).toEqual(report);
    expect(parseAiCostReport({ ...report, daily: [{ ...report.daily[0], feature: 'cv_import' }] })).toBeNull();
    expect(parseAiCostReport({ ...report, daily: [{ ...report.daily[0], calls: -1 }] })).toBeNull();
    expect(parseAiBudgetStatus('x')).toBeNull();
    // Nieznane klucze (np. identyfikator) są odcinane przez schemat — nie trafiają do UI.
    const parsed = parseAiCostReport({ ...report, daily: [{ ...report.daily[0], id: 'uuid', email: 'a@b.be' }] });
    expect(Object.keys(parsed!.daily[0]!)).not.toContain('email');
  });

  it('pusty raport DEMO ma limity startowe z migracji', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase/migrations/0114_ai_budget.sql'), 'utf8');
    const empty = emptyAiCostReport();
    expect(sql).toContain(`('day', ${empty.status.day.limitMicroUsd})`);
    expect(sql).toContain(`('month', ${empty.status.month.limitMicroUsd})`);
  });

  it('klucze schematów występują w SQL raportu i stanu (0114)', () => {
    const sql = readFileSync(join(__dirname, '..', '..', 'supabase/migrations/0114_ai_budget.sql'), 'utf8');
    const keys = [
      ...Object.keys(aiCostReportSchema.shape),
      ...Object.keys(aiCostReportSchema.shape.daily.element.shape),
      ...Object.keys(aiCostReportSchema.shape.monthly.element.shape),
      ...Object.keys(aiBudgetStatusSchema.shape),
      'spentMicroUsd',
      'limitMicroUsd',
    ];
    for (const key of keys) expect(sql, key).toContain(`'${key}'`);
  });

  it('kwoty w USD z mikro-USD', () => {
    expect(createUsdFormatter('en')(1_234_567)).toBe('$1.23');
  });
});
