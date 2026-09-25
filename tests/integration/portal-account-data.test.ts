import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';
import type { PortalIdentity } from '../../src/lib/auth/session';

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { deleteMyAccountAction } = await import('../../src/lib/actions/account-data');
const { POST: exportData } = await import('../../src/app/api/account/export/route');
const { processStorageDeletions } = await import('../../src/lib/storage-deletion');

// #25 po scaleniu #486: eksport i usunięcie konta pod sesją kandydata, kolejka usuwania
// obiektów storage przez pulę service — PostgreSQL 16 z migracjami produkcyjnymi.
let alice: PortalIdentity;
let bob: PortalIdentity;
let employer: PortalIdentity;

function exportRequest() {
  return new Request('http://localhost:3000/api/account/export', { method: 'POST', headers: { origin: 'http://localhost:3000' } });
}

beforeAll(async () => {
  const db = await startPortalDb();
  realSession.db = db;
  alice = { id: await db.createUser('candidate', 'pl'), role: 'candidate' };
  bob = { id: await db.createUser('candidate', 'nl'), role: 'candidate' };
  employer = { id: await db.createUser('employer', 'fr'), role: 'employer' };
  await db.admin.query(`UPDATE public.profiles SET first_name = 'Ala' WHERE id = $1`, [alice.id]);
  await db.admin.query(`UPDATE public.profiles SET first_name = 'Bob' WHERE id = $1`, [bob.id]);
  await db.admin.query(`INSERT INTO public.files(owner_id, bucket, path, file_name, entity_type, mime_type, size_bytes)
    VALUES ($1, 'candidate-files', $2, 'cv.pdf', 'candidate_cv', 'application/pdf', 100)`, [alice.id, `${alice.id}/cv.pdf`]);
});

afterAll(async () => { await realSession.db?.stop(); });

describe('eksport danych (#486) pod sesją', () => {
  it('kandydat pobiera wyłącznie własne dane; gość → 401', async () => {
    actAs(alice);
    const res = await exportData(exportRequest());
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Ala');
    expect(body).not.toContain('Bob');
    actAs(null);
    expect((await exportData(exportRequest())).status).toBe(401);
  });
});

describe('usunięcie konta (#486) i kolejka storage', () => {
  it('zły adres → mismatch bez zmian; pracodawca → denied; poprawny → konto, sesje i plik do kolejki', async () => {
    const admin = realSession.db!.admin;
    const email = (await admin.query('SELECT email FROM auth.users WHERE id = $1', [alice.id])).rows[0].email as string;
    actAs(alice);
    expect(await deleteMyAccountAction('inny@example.invalid')).toEqual({ ok: false, error: 'mismatch' });
    expect((await admin.query('SELECT count(*)::int AS n FROM public.profiles WHERE id = $1', [alice.id])).rows[0].n).toBe(1);

    actAs(employer);
    const employerEmail = (await admin.query('SELECT email FROM auth.users WHERE id = $1', [employer.id])).rows[0].email as string;
    expect(await deleteMyAccountAction(employerEmail)).toEqual({ ok: false, error: 'denied' });

    actAs(alice);
    expect(await deleteMyAccountAction(email.toUpperCase())).toEqual({ ok: true });
    expect((await admin.query('SELECT count(*)::int AS n FROM auth.users WHERE id = $1', [alice.id])).rows[0].n).toBe(0);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.profiles WHERE id = $1', [bob.id])).rows[0].n).toBe(1);

    const removed: string[] = [];
    const run = await processStorageDeletions(async (_bucket, path) => { removed.push(path); return null; });
    expect(run).toEqual({ claimed: 1, deleted: 1, failed: 0 });
    expect(removed).toEqual([`${alice.id}/cv.pdf`]);
    expect((await admin.query('SELECT count(*)::int AS n FROM public.storage_deletion_queue')).rows[0].n).toBe(0);
  });
});
