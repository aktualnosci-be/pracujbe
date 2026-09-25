import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { PortalIdentity } from '@/lib/auth/session';
import { getJobCompanyBlockAction, setCompanyBlockAction } from '@/lib/actions/company-blocks';
import { getJobCompanyBlock, loadMyCompanyBlocks } from '@/lib/data/company-blocks';
import { captureError } from '@/lib/sentry';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));

const ME = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const COMPANY = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const JOB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb({ id: ME, role: 'candidate' } as PortalIdentity);
});

describe('setCompanyBlockAction (#97)', () => {
  it('blokuje i odblokowuje przez RPC pod sesją', async () => {
    fakeDb.rpc('set_company_block', ({ args }: { args: Record<string, unknown> }) => args['p_blocked']);
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: true, blocked: true });
    expect(await setCompanyBlockAction(COMPANY, false)).toEqual({ ok: true, blocked: false });
    expect(fakeDb.callsTo('set_company_block')[0]).toMatchObject({
      args: { p_company_id: COMPANY, p_blocked: true },
      as: ME,
    });
  });

  it.each([
    ['nie-UUID', 'c1', true],
    ['wstrzyknięcie', `${COMPANY}' or '1'='1`, true],
    ['brak flagi', COMPANY, 'yes'],
  ])('odrzuca %s, zanim zapyta bazę', async (_reason, companyId, blocked) => {
    fakeDb.rpc('set_company_block', true);
    expect(await setCompanyBlockAction(companyId, blocked)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('mapuje odmowę bazy na kod bez technikaliów; bez sesji bez zapytania', async () => {
    fakeDb.rpc('set_company_block', () => {
      throw pgError('42501', 'PERMISSION_DENIED: blokada firm tylko dla kandydata');
    });
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    fakeDb.rpc('set_company_block', () => {
      throw pgError('42P01', 'relation "x" does not exist');
    });
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: false, error: 'INTERNAL' });
    fakeDb.rpc('set_company_block', () => {
      throw new Error('ECONNREFUSED');
    });
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: false, error: 'INTERNAL' });
    expect(captureError).toHaveBeenCalledTimes(1);

    const before = fakeDb.calls.length;
    fakeSession.identity = null;
    expect(await setCompanyBlockAction(COMPANY, true)).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(before);
  });

  it('tryb demo: waliduje identyfikator firmy demo i nie zapisuje', async () => {
    fakeSession.configured = false;
    expect(await setCompanyBlockAction('c11', false)).toEqual({ ok: true, blocked: false, demo: true });
    expect(await setCompanyBlockAction('drop table', false)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('odczyt blokad', () => {
  it('lista własnych blokad z nazwą firmy; błąd ≠ pusta lista', async () => {
    fakeDb.rpc('get_my_company_blocks', [
      { company_id: COMPANY, company_name: 'Firma', blocked_at: '2026-09-20T10:00:00Z' },
    ]);
    expect(await loadMyCompanyBlocks()).toEqual({
      status: 'ready',
      demo: false,
      blocks: [{ companyId: COMPANY, companyName: 'Firma', blockedAt: '2026-09-20T10:00:00Z' }],
    });
    expect(fakeDb.callsTo('get_my_company_blocks')[0]).toMatchObject({ kind: 'rpcrows', as: ME });

    const readError = pgError('XX000', 'boom');
    fakeDb.rpc('get_my_company_blocks', () => { throw readError; });
    expect(await loadMyCompanyBlocks()).toEqual({ status: 'error' });
    expect(captureError).toHaveBeenCalledWith(readError, { area: 'company-blocks.loadMyCompanyBlocks' });
  });

  it('tryb demo: przykładowa blokada oznaczona demo', async () => {
    fakeSession.configured = false;
    const result = await loadMyCompanyBlocks();
    expect(result).toMatchObject({ status: 'ready', demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('stan na szczególe oferty: gość i brak wiersza → none, kandydat → stan', async () => {
    fakeDb.rpc('get_job_company_block', []);
    fakeSession.identity = null;
    expect(await getJobCompanyBlock(JOB)).toEqual({ status: 'none' });
    expect(fakeDb.calls).toHaveLength(0);

    fakeSession.identity = { id: ME, role: 'candidate' } as PortalIdentity;
    expect(await getJobCompanyBlock(JOB)).toEqual({ status: 'none' });

    fakeDb.rpc('get_job_company_block', [{ company_id: COMPANY, company_name: 'Firma', blocked: true }]);
    expect(await getJobCompanyBlock(JOB)).toEqual({
      status: 'ready', companyId: COMPANY, companyName: 'Firma', blocked: true,
    });
    expect(fakeDb.callsTo('get_job_company_block').at(-1)!.args).toEqual({ p_job_id: JOB });
  });

  it('akcja szczegółu oferty odrzuca nie-UUID bez zapytania', async () => {
    fakeDb.rpc('get_job_company_block', []);
    expect(await getJobCompanyBlockAction('../etc')).toEqual({ status: 'none' });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
