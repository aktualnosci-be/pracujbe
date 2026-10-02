import { describe, expect, it } from 'vitest';

import type { JobCostLabels } from '@/lib/job-costs';
import type { JobDetail } from '@/lib/jobs';
import type { SavedJob } from '@/lib/saved-job-availability';
import {
  buildCompareModel,
  COMPARE_REQUIREMENTS_LIMIT,
  parseCompareSelection,
  type CompareFormatters,
} from '@/lib/saved-job-compare';
import { salaryLabelsFor } from '@/lib/salary-labels';

/**
 * #816 — porównanie warunków 2–3 zapisanych ofert: wybór z adresu (tylko własne zapisy, limit 3),
 * wiersze z jawnym „brak danych”, oryginalna waluta i okres stawki, oferta niedostępna.
 */

const A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const C = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const D = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const FOREIGN = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const SAVED = new Set([A, B, C, D]);

describe('wybór do porównania z adresu', () => {
  it('lista po przecinku i powtórzony klucz, unikalne, w kolejności', () => {
    expect(parseCompareSelection(`${A},${B}`, SAVED)).toEqual({ ids: [A, B], truncated: false, requested: true });
    expect(parseCompareSelection([B, A, B], SAVED).ids).toEqual([B, A]);
    expect(parseCompareSelection(A.toUpperCase(), SAVED).ids).toEqual([A]);
  });

  it('bez parametru = brak żądania; śmieci i cudze oferty pominięte (nie da się porównać cudzej)', () => {
    expect(parseCompareSelection(undefined, SAVED)).toEqual({ ids: [], truncated: false, requested: false });
    expect(parseCompareSelection(`nie-uuid,${FOREIGN},${A}`, SAVED)).toEqual({ ids: [A], truncated: false, requested: true });
    // Kontrola ujemna: gdy oferta nie jest w zapisach, ta sama wartość jest pominięta.
    expect(parseCompareSelection(FOREIGN, SAVED).ids).toEqual([]);
  });

  it('najwyżej 3 oferty, nadmiar oznaczony', () => {
    expect(parseCompareSelection([A, B, C, D], SAVED)).toEqual({ ids: [A, B, C], truncated: true, requested: true });
  });
});

const costLabels: JobCostLabels = {
  accommodation: 'Zakwaterowanie', transport: 'Transport', mealVouchers: 'Bony', jointCommittee: 'Komisja',
  yes: 'Tak', no: 'Nie',
  kind: (kind) => `rodzaj:${kind}`,
  cost: (amount, period) => `koszt ${amount}/${period}`,
  free: 'bez kosztów',
  deducted: (yes) => (yes ? 'potrącane' : 'niepotrącane'),
  registration: (yes) => (yes ? 'zameldowanie' : 'bez zameldowania'),
  afterContract: (value) => `po umowie:${value}`,
  shuttle: 'dowóz', reimbursed: 'zwrot kosztów',
  mealPerDay: (amount) => `${amount}/dzień`,
  committeeCode: (code) => `PC ${code}`,
  money: (amount) => `€${amount}`,
};
const formatters: CompareFormatters = {
  locale: 'pl',
  salaryLabels: salaryLabelsFor('pl'),
  contract: (type) => `umowa:${type}`,
  costLabels,
};

function saved(id: string, patch: Partial<SavedJob> = {}): SavedJob {
  return { id, slug: `oferta-${id.slice(0, 2)}`, title: `Oferta ${id.slice(0, 2)}`, companyName: 'Firma', city: 'Gent', availability: 'available', ...patch };
}
function detail(id: string, patch: Partial<JobDetail> = {}): JobDetail {
  return {
    id, slug: `oferta-${id.slice(0, 2)}`, title: `Szczegół ${id.slice(0, 2)}`, companyName: 'Firma', companyVerified: true,
    city: 'Gent', region: 'Flandria', contractType: 'permanent', currency: 'EUR', publishedAt: '2026-09-01T00:00:00Z',
    isNew: false, highlights: [], category: 'warehouse', accommodation: false, immediate: false, noLanguageRequired: false,
    description: '', responsibilities: [], requirementsMandatory: [], requirementsOptional: [], conditions: [],
    workingHours: '', languages: [], transport: false, companyDescription: '',
    ...patch,
  } as JobDetail;
}

describe('model porównania', () => {
  it('waluta i okres stawki zostają z oferty, brak danych jawnie, bez przeliczeń', () => {
    const model = buildCompareModel([A, B], [saved(A), saved(B)], {
      [A]: { status: 'ok', detail: detail(A, { salaryMin: 15, salaryMax: 18, currency: 'EUR', salaryPeriod: 'hour', workingHours: '38 h/tydz.', shifts: 'dzienna' }) },
      [B]: { status: 'ok', detail: detail(B, { salaryMin: 2400, currency: 'PLN', salaryPeriod: 'month', contractType: 'temporary' }) },
    }, formatters);
    expect(model.columns.map((c) => [c.id, c.state, c.slug])).toEqual([[A, 'available', 'oferta-aa'], [B, 'available', 'oferta-bb']]);
    const row = (key: string) => model.rows.find((r) => r.key === key)!.cells;
    const salaryA = row('salary')[0]!;
    const salaryB = row('salary')[1]!;
    expect(salaryA.kind === 'text' && salaryA.lines[0]).toMatch(/15.*18.*€|€.*15.*18/);
    expect(salaryA.kind === 'text' && salaryA.lines[0]).not.toMatch(/PLN|zł/);
    expect(salaryB.kind === 'text' && salaryB.lines[0]).toMatch(/PLN|zł/);
    expect(row('contract')).toEqual([{ kind: 'text', lines: ['umowa:permanent'] }, { kind: 'text', lines: ['umowa:temporary'] }]);
    expect(row('hours')).toEqual([{ kind: 'text', lines: ['38 h/tydz.'] }, { kind: 'none' }]);
    expect(row('shifts')).toEqual([{ kind: 'text', lines: ['dzienna'] }, { kind: 'none' }]);
    expect(row('requirements')).toEqual([{ kind: 'none' }, { kind: 'none' }]);
  });

  it('oferta bez kwoty = brak danych (bez „do negocjacji”)', () => {
    const model = buildCompareModel([A, B], [saved(A), saved(B)], {
      [A]: { status: 'ok', detail: detail(A) }, [B]: { status: 'ok', detail: detail(B) },
    }, formatters);
    expect(model.rows.find((r) => r.key === 'salary')!.cells).toEqual([{ kind: 'none' }, { kind: 'none' }]);
  });

  it('zakwaterowanie i transport z „Kosztów i dodatków” albo z flag starych ofert', () => {
    const model = buildCompareModel([A, B], [saved(A), saved(B)], {
      [A]: { status: 'ok', detail: detail(A, {
        accommodation: true, transport: true,
        costs: { accommodationKind: 'provided', accommodationCost: 0, accommodationCostPeriod: 'week', accommodationDeducted: false, transportShuttle: true },
      } as Partial<JobDetail>) },
      [B]: { status: 'ok', detail: detail(B, { accommodation: true, transport: false }) },
    }, formatters);
    const accommodation = model.rows.find((r) => r.key === 'accommodation')!.cells;
    expect(accommodation[0]).toEqual({ kind: 'text', lines: ['rodzaj:provided', 'bez kosztów', 'niepotrącane'] });
    expect(accommodation[1]).toEqual({ kind: 'text', lines: ['Tak'] });
    const transport = model.rows.find((r) => r.key === 'transport')!.cells;
    expect(transport).toEqual([{ kind: 'text', lines: ['dowóz'] }, { kind: 'text', lines: ['Nie'] }]);
  });

  it('kluczowe wymagania: obowiązkowe, bez pustych, najwyżej pięć', () => {
    const many = Array.from({ length: 8 }, (_, i) => `Wymóg ${i + 1}`);
    const model = buildCompareModel([A, B], [saved(A), saved(B)], {
      [A]: { status: 'ok', detail: detail(A, { requirementsMandatory: [' ', ...many] }) },
      [B]: { status: 'ok', detail: detail(B) },
    }, formatters);
    const cell = model.rows.find((r) => r.key === 'requirements')!.cells[0]!;
    expect(cell.kind === 'list' && cell.items).toHaveLength(COMPARE_REQUIREMENTS_LIMIT);
    expect(cell.kind === 'list' && cell.items[0]).toBe('Wymóg 1');
  });

  it('oferta niedostępna (wygasła, zamknięta) i błąd odczytu: kolumna ze stanem, komórki „niedostępna”', () => {
    const model = buildCompareModel([A, B, C], [
      saved(A),
      saved(B, { availability: 'expired', slug: null }),
      saved(C),
    ], {
      [A]: { status: 'ok', detail: detail(A) },
      // C: szczegóły nie wczytały się (brak wpisu = błąd odczytu).
    }, formatters);
    expect(model.columns.map((c) => c.state)).toEqual(['available', 'expired', 'error']);
    expect(model.columns[1]!.slug).toBeNull();
    expect(model.columns[2]!.slug).toBeNull();
    for (const row of model.rows) {
      expect(row.cells[1]).toEqual({ kind: 'unavailable' });
      expect(row.cells[2]).toEqual({ kind: 'unavailable' });
    }
    // Oferta, która zniknęła między listą a odczytem szczegółów.
    const gone = buildCompareModel([A, B], [saved(A), saved(B)], {
      [A]: { status: 'ok', detail: detail(A) }, [B]: { status: 'unavailable' },
    }, formatters);
    expect(gone.columns[1]!.state).toBe('unavailable');
  });

  it('kontrola ujemna: identyfikator spoza zapisów nie tworzy kolumny', () => {
    const model = buildCompareModel([A, FOREIGN], [saved(A)], { [A]: { status: 'ok', detail: detail(A) } }, formatters);
    expect(model.columns).toHaveLength(1);
    expect(model.rows[0]!.cells).toHaveLength(1);
  });
});
