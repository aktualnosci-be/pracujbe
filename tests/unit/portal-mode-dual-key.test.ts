// @vitest-environment node
import { describe, expect, it } from 'vitest';

import {
  effectiveRecruitmentEnabled,
  portalLegalModeAlerts,
  portalLegalModeSummary,
} from '@/lib/ops/portal-mode';

/**
 * #1143 — dwuklucz trybu portalu: rekrutacja tylko przy env RECRUITMENT ORAZ bazie RECRUITMENT.
 * Tabela prawdy dla 4 kombinacji; kontrola ujemna: mutacja „lub” (albo tylko env) jest czerwona.
 */
const TRUTH: Array<[env: boolean, db: boolean, effective: boolean]> = [
  [false, false, false],
  [false, true, false],
  [true, false, false],
  [true, true, true],
];

function violations(fn: (env: boolean, db: boolean) => boolean): string[] {
  return TRUTH.filter(([env, db, want]) => fn(env, db) !== want).map(([env, db]) => `env=${env},db=${db}`);
}

describe('tryb efektywny = env × baza (#1143)', () => {
  it.each(TRUTH)('env=%s, baza=%s → %s', (env, db, want) => {
    expect(effectiveRecruitmentEnabled(env, db)).toBe(want);
  });

  it('tylko RECRUITMENT × RECRUITMENT włącza rekrutację', () => {
    expect(violations(effectiveRecruitmentEnabled)).toEqual([]);
  });

  it('kontrola ujemna: mutacja „lub” i „tylko env” łamią tabelę prawdy', () => {
    expect(violations((env, db) => env || db)).toEqual(['env=false,db=true', 'env=true,db=false']);
    expect(violations((env) => env)).toEqual(['env=true,db=false']);
  });
});

describe('czujka portal_legal_mode_mismatch (#1143)', () => {
  it('zgodność env i bazy → brak alarmu', () => {
    expect(portalLegalModeAlerts(0, false)).toEqual([]);
    expect(portalLegalModeAlerts(1, true)).toEqual([]);
  });

  it('rozbieżność w obie strony → alarm', () => {
    expect(portalLegalModeAlerts(1, false)).toEqual(['portal_legal_mode_mismatch']);
    expect(portalLegalModeAlerts(0, true)).toEqual(['portal_legal_mode_mismatch']);
  });

  it('baza bez sekcji trybu (sprzed 0171) = tryb ogłoszeniowy bazy (fail-closed)', () => {
    expect(portalLegalModeAlerts(undefined, false)).toEqual([]);
    expect(portalLegalModeAlerts(null, true)).toEqual(['portal_legal_mode_mismatch']);
  });

  it('opis trybów: efektywny ogłoszeniowy przy każdej rozbieżności', () => {
    expect(portalLegalModeSummary(1, false)).toEqual({
      env: 'CLASSIFIEDS_ONLY', database: 'RECRUITMENT', effective: 'CLASSIFIEDS_ONLY',
    });
    expect(portalLegalModeSummary(0, true)).toEqual({
      env: 'RECRUITMENT', database: 'CLASSIFIEDS_ONLY', effective: 'CLASSIFIEDS_ONLY',
    });
    expect(portalLegalModeSummary(1, true).effective).toBe('RECRUITMENT');
  });
});
