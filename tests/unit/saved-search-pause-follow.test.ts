import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * #810 (pauza alertów) i #855 (obserwowanie firmy) — warstwa aplikacji: akcje i loadery.
 * Zachowanie bazy (worker, pauza, dolna granica, filtr firmy, RLS): `supabase/tests/rls.sql`
 * sekcje PS969/FC969 (kontrole ujemne na definicji workera).
 */

vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }));

import type { PortalIdentity } from '@/lib/auth/session';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';
import {
  followCompanyAction,
  getCompanyFollowState,
  setAlertsPauseAction,
  unfollowCompanyAction,
} from '@/lib/actions/saved-searches';
import { loadMyAlertsPause, loadMyFollowedCompanies } from '@/lib/data/saved-searches';
import { pauseDateRange } from '@/lib/datetime';

const USER = '11111111-1111-4111-8111-111111111111';
const COMPANY = '22222222-2222-4222-8222-222222222222';
const MIGRATION = readFileSync(
  resolve(__dirname, '../../supabase/migrations/0969_saved_search_pause_company_follow.sql'),
  'utf8',
);

beforeEach(() => {
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
});

describe('pauza alertów (#810)', () => {
  it('data wznowienia trafia do RPC jako date; null = wznowienie od razu', async () => {
    fakeDb.rpc('set_saved_search_alerts_pause', null);
    expect(await setAlertsPauseAction('2026-10-20')).toEqual({ ok: true });
    expect(await setAlertsPauseAction(null)).toEqual({ ok: true });
    const calls = fakeDb.callsTo('set_saved_search_alerts_pause');
    expect(calls.map((c) => c.args)).toEqual([{ p_until: '2026-10-20' }, { p_until: null }]);
    expect(calls.every((c) => c.as === USER)).toBe(true);
  });

  it('zły kształt daty odrzucony przed bazą (kontrola ujemna: dzień spoza kalendarza)', async () => {
    for (const bad of ['jutro', '2026-13-01', '2026-02-30', '20261020', 5, undefined]) {
      expect(await setAlertsPauseAction(bad)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    }
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('demo, brak sesji i błąd bazy bez technikaliów', async () => {
    fakeSession.configured = false;
    expect(await setAlertsPauseAction('2026-10-20')).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
    fakeSession.configured = true;
    fakeSession.identity = null;
    expect(await setAlertsPauseAction('2026-10-20')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeSession.identity = { id: USER, role: 'candidate' } as PortalIdentity;
    fakeDb.rpc('set_saved_search_alerts_pause', () => { throw pgError('22023', 'VALIDATION_FAILED: data wznowienia od jutra do roku'); });
    expect(await setAlertsPauseAction('2030-01-01')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
  });

  it('odczyt: trwająca pauza jako ISO, brak = null, błąd ≠ „brak pauzy”', async () => {
    fakeDb.rows('saved-searches.pause', [{ paused_until: new Date('2026-10-20T22:00:00Z') }]);
    expect(await loadMyAlertsPause()).toEqual({ status: 'ready', pausedUntil: '2026-10-20T22:00:00.000Z' });
    expect(fakeDb.callsTo('saved-searches.pause')[0]).toMatchObject({ values: [USER], as: USER });
    expect(fakeDb.callsTo('saved-searches.pause')[0]!.text).toContain('paused_until > now()');
    fakeDb.rows('saved-searches.pause', []);
    expect(await loadMyAlertsPause()).toEqual({ status: 'ready', pausedUntil: null });
    fakeDb.rows('saved-searches.pause', () => { throw pgError('XX000', 'boom'); });
    expect(await loadMyAlertsPause()).toEqual({ status: 'error' });
    fakeSession.configured = false;
    expect(await loadMyAlertsPause()).toEqual({ status: 'ready', pausedUntil: null });
  });

  it('zakres dat = granice RPC: jutro..+366 dni w Europe/Brussels', () => {
    // 2026-09-29 23:30 UTC = 30.09 w Brukseli (CEST) → najwcześniej 1.10.
    expect(pauseDateRange(new Date('2026-09-29T23:30:00Z'))).toEqual({ min: '2026-10-01', max: '2027-10-01' });
    expect(pauseDateRange(new Date('2026-09-29T10:00:00Z')).min).toBe('2026-09-30');
    expect(MIGRATION).toContain('p_until <= v_today or p_until > v_today + 366');
  });
});

describe('obserwowanie firmy (#855)', () => {
  it('follow/unfollow: identyfikator i język do RPC, idempotentnie', async () => {
    fakeDb.rpc('follow_company', [{ saved_search_id: 's1', created: true }]);
    fakeDb.rpc('unfollow_company', null);
    expect(await followCompanyAction(COMPANY, 'nl')).toEqual({ ok: true });
    expect(fakeDb.callsTo('follow_company')[0]).toMatchObject({ args: { p_company_id: COMPANY, p_locale: 'nl' }, as: USER });
    expect(await unfollowCompanyAction(COMPANY)).toEqual({ ok: true });
    expect(fakeDb.callsTo('unfollow_company')[0]!.args).toEqual({ p_company_id: COMPANY });
  });

  it('walidacja, gość, limit i firma niedostępna', async () => {
    expect(await followCompanyAction('nie-uuid', 'pl')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await followCompanyAction(COMPANY, 'de')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(await unfollowCompanyAction('x')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
    fakeSession.identity = null;
    expect(await followCompanyAction(COMPANY, 'pl')).toEqual({ ok: false, error: 'UNAUTHENTICATED' });
    fakeSession.identity = { id: USER, role: 'candidate' } as PortalIdentity;
    fakeDb.rpc('follow_company', () => { throw pgError('42501', 'SAVED_SEARCH_LIMIT_REACHED: najwyżej 20 zapisanych wyszukiwań'); });
    expect(await followCompanyAction(COMPANY, 'pl')).toEqual({ ok: false, error: 'SAVED_SEARCH_LIMIT_REACHED' });
    fakeDb.rpc('follow_company', () => { throw pgError('P0002', 'NOT_FOUND: firma nie istnieje'); });
    expect(await followCompanyAction(COMPANY, 'pl')).toEqual({ ok: false, error: 'NOT_FOUND' });
    fakeSession.configured = false;
    expect(await followCompanyAction(COMPANY, 'pl')).toEqual({ ok: false, error: 'DEMO_UNAVAILABLE' });
  });

  it('stan wyspy: gość, pracodawca, kandydat obserwujący i nie, błąd', async () => {
    fakeDb.rpc('get_my_followed_companies', [{ saved_search_id: 's1', company_id: COMPANY, company_slug: 'firma' }]);
    expect(await getCompanyFollowState(COMPANY)).toEqual({ status: 'candidate', following: true });
    expect(await getCompanyFollowState('33333333-3333-4333-8333-333333333333')).toEqual({ status: 'candidate', following: false });
    expect(await getCompanyFollowState('nie-uuid')).toEqual({ status: 'unavailable' });
    fakeSession.identity = null;
    expect(await getCompanyFollowState(COMPANY)).toEqual({ status: 'anonymous' });
    fakeSession.identity = { id: 'e', role: 'employer' } as PortalIdentity;
    expect(await getCompanyFollowState(COMPANY)).toEqual({ status: 'unavailable' });
    fakeSession.identity = { id: USER, role: 'candidate' } as PortalIdentity;
    fakeDb.rpc('get_my_followed_companies', () => { throw pgError('XX000', 'boom'); });
    expect(await getCompanyFollowState(COMPANY)).toEqual({ status: 'error' });
  });

  it('lista: mapa obserwacji z adresem profilu; awaria = pusta mapa (lista wyszukiwań zostaje)', async () => {
    fakeDb.rpc('get_my_followed_companies', [
      { saved_search_id: 's1', company_id: COMPANY, company_slug: 'firma' },
      { saved_search_id: 's2', company_id: 'c2', company_slug: null },
    ]);
    const map = await loadMyFollowedCompanies();
    expect([...map.entries()]).toEqual([['s1', { slug: 'firma' }], ['s2', { slug: null }]]);
    fakeDb.rpc('get_my_followed_companies', () => { throw pgError('XX000', 'boom'); });
    expect((await loadMyFollowedCompanies()).size).toBe(0);
  });
});

describe('migracja 0969: kontrakt', () => {
  it('worker pomija pauzę i liczy nowości od jej końca; obserwacja po company_id', () => {
    expect(MIGRATION).toContain('and (ap.paused_until is null or ap.paused_until <= v_run_at)');
    expect(MIGRATION).toContain("coalesce(v_search.paused_until, '-infinity'::timestamptz)");
    expect(MIGRATION).toContain('where j.company_id = v_search.company_id');
    // Kontrola ujemna: obserwacja nie może czytać filtrów listy ani dopasowań.
    expect(MIGRATION).not.toMatch(/candidate_profiles|\bmatches\b/);
  });
});
