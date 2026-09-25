import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #603 — eksport wpisu rejestru naruszeń (`admin_export_breach_incident`) zapisuje zdarzenie
 * w historii incydentu i w dzienniku audytowym, więc nie może być dostępny przez `GET`
 * (bezpieczna metoda, RFC 9110 §9.2.1): prefetch, odświeżenie, link z obcej strony albo
 * osadzony zasób nie mogą mnożyć zdarzeń eksportu. `POST` dodatkowo wymaga zgodnego `Origin`
 * (jak `/api/account/export`, #486) — cookie sesji samo nie chroni każdej nawigacji GET.
 */

vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { GET, POST } = await import('@/app/api/admin/breaches/[id]/export/route');

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'admin' } as const;
const INCIDENT_ID = '22222222-2222-4222-8222-222222222222';

function params() {
  return { params: Promise.resolve({ id: INCIDENT_ID }) };
}

function exportRequest(origin: string | null, format: 'json' | 'csv' = 'json'): Request {
  return new Request(`https://pracuj.be/api/admin/breaches/${INCIDENT_ID}/export?format=${format}`, {
    method: 'POST',
    headers: origin ? { origin } : {},
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  resetFakeDb(ADMIN);
  fakeDb.rpc('admin_export_breach_incident', {
    incident: { reference: 'BR-0001' },
    events: [],
    exportedAt: '2026-09-25T00:00:00Z',
  });
});

describe('GET /api/admin/breaches/[id]/export (#603)', () => {
  it('405 z Allow: POST — bez sesji, bez RPC, bez zapisu w historii/dzienniku', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('POST /api/admin/breaches/[id]/export (#603)', () => {
  it('bez Origin albo z obcej witryny → 403 bez wywołania RPC (CSRF)', async () => {
    for (const origin of [null, 'https://evil.example']) {
      const response = await POST(exportRequest(origin), params());
      expect(response.status).toBe(403);
    }
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('zgodny Origin → eksport JSON, RPC wywołane raz pod sesją admina', async () => {
    const response = await POST(exportRequest('https://pracuj.be'), params());
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    const [call] = fakeDb.callsTo('admin_export_breach_incident');
    expect(call).toMatchObject({ args: { p_id: INCIDENT_ID, p_format: 'json' }, as: ADMIN.id });
  });

  it('każde POST-wywołanie jest osobnym eksportem — dwa POST-y to dwa wywołania RPC', async () => {
    await POST(exportRequest('https://pracuj.be'), params());
    await POST(exportRequest('https://pracuj.be'), params());
    expect(fakeDb.callsTo('admin_export_breach_incident')).toHaveLength(2);
  });

  it('bez sesji → 404 (nie ujawnia istnienia panelu), bez wywołania RPC', async () => {
    fakeSession.identity = null;
    const response = await POST(exportRequest('https://pracuj.be'), params());
    expect(response.status).toBe(404);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('błąd RPC NOT_FOUND → 404', async () => {
    fakeDb.rpc('admin_export_breach_incident', () => {
      throw pgError('P0001', 'NOT_FOUND');
    });
    const response = await POST(exportRequest('https://pracuj.be'), params());
    expect(response.status).toBe(404);
  });
});
