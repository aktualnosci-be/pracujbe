import { beforeEach, describe, expect, it, vi } from 'vitest';

import { fakeDb, fakeSession, resetFakeDb } from '../helpers/fake-db';

/**
 * Eksport dziennika zdarzeń (`POST /api/admin/audit-export`): tylko admin (inaczej 404, bez
 * odczytu), tylko POST z Origin tej witryny (GET = 405, obcy Origin = 403), `no-store`, te same
 * filtry co lista, limit wierszy z informacją o obcięciu, CSV z neutralizacją formuł, czas
 * w Europe/Brussels, wpis `audit_log.exported` bez treści (w tej samej transakcji).
 */

vi.mock('@/lib/env', () => ({ env: { siteUrl: 'https://pracuj.be' } }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { GET, POST } = await import('@/app/api/admin/audit-export/route');
const { exportAuditLogs } = await import('@/lib/data/admin');
const { auditExportCsv, toBrusselsIso } = await import('@/lib/admin/audit-export');
const { csvCell } = await import('@/lib/admin/breach');

const ADMIN = { id: '11111111-1111-4111-8111-111111111111', role: 'admin' } as const;
const ACTOR = '33333333-3333-4333-8333-333333333333';
const COMPANY = '44444444-4444-4444-8444-444444444444';

function logRow(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    actor_id: null,
    action: 'company.status_changed',
    entity_type: 'company',
    entity_id: COMPANY,
    before_data: { status: 'pending' },
    after_data: { status: 'rejected', reason: 'Brak danych' },
    created_at: '2026-07-01T10:00:00.000Z',
    ...extra,
  };
}

function exportRequest(
  query: string,
  origin: string | null = 'https://pracuj.be',
): Request {
  return new Request(`https://pracuj.be/api/admin/audit-export?${query}`, {
    method: 'POST',
    headers: origin ? { origin } : {},
  });
}

function registerDefaults(rows: unknown[] = [logRow(1)]) {
  fakeDb
    .rows('admin.audit-logs', rows)
    .rows('admin.audit-actors', [
      { id: ACTOR, first_name: 'Anna', last_name: 'Admin', email: 'anna@example.test' },
    ])
    .rows('admin.audit-companies', [{ id: COMPANY, name: 'Firma Test', deleted_at: null }])
    .rows('admin.audit-actor-search', [{ id: ACTOR }])
    .exec('admin.audit-export-log', 1);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(ADMIN);
  registerDefaults();
});

describe('GET /api/admin/audit-export', () => {
  it('405 z Allow: POST — bez sesji, bez odczytu i bez wpisu w dzienniku', async () => {
    const response = await GET();
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('POST');
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('POST /api/admin/audit-export — dostęp', () => {
  it('bez Origin albo z obcej witryny → 403 bez dostępu do bazy (CSRF)', async () => {
    for (const origin of [null, 'https://evil.example']) {
      const response = await POST(exportRequest('format=csv', origin));
      expect(response.status).toBe(403);
    }
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('bez sesji → 404, bez odczytu dziennika i bez wpisu', async () => {
    fakeSession.identity = null;
    const response = await POST(exportRequest('format=json'));
    expect(response.status).toBe(404);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('kontrola ujemna: pracodawca i kandydat → 404, nic nie czytamy service-rolem', async () => {
    for (const role of ['employer', 'candidate'] as const) {
      fakeSession.identity = { id: ACTOR, role };
      const response = await POST(exportRequest('format=csv'));
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('');
    }
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb DEMO (bez bazy) → 404', async () => {
    fakeSession.configured = false;
    const response = await POST(exportRequest('format=csv'));
    expect(response.status).toBe(404);
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('błąd zapisu wpisu audytu → 500 i brak treści eksportu', async () => {
    fakeDb.exec('admin.audit-export-log', () => {
      throw new Error('insert failed');
    });
    const response = await POST(exportRequest('format=csv'));
    expect(response.status).toBe(500);
    expect(await response.text()).toBe('');
  });
});

describe('POST /api/admin/audit-export — treść', () => {
  it('CSV: no-store, nagłówki, czas w Europe/Brussels, aktor „System”, bez e-maili', async () => {
    registerDefaults([
      logRow(1),
      logRow(2, { actor_id: ACTOR, action: 'report.resolved', entity_type: 'report', entity_id: null }),
    ]);
    const response = await POST(exportRequest('format=csv'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store, private');
    expect(response.headers.get('content-type')).toContain('text/csv');
    expect(response.headers.get('content-disposition')).toMatch(/attachment; filename="audit-log-\d{4}-\d{2}-\d{2}\.csv"/);
    expect(response.headers.get('x-export-truncated')).toBe('false');
    const body = await response.text();
    const lines = body.trimEnd().split('\r\n');
    expect(lines[0]).toBe(
      'created_at,action,entity_type,entity_id,entity_label,status_before,status_after,reason,actor',
    );
    // 10:00 UTC w lipcu = 12:00 w Brukseli (CEST).
    expect(lines[1]).toBe(
      `2026-07-01T12:00:00+02:00,company.status_changed,company,${COMPANY},Firma Test,pending,rejected,Brak danych,System`,
    );
    expect(lines[2]).toContain(',Anna Admin');
    expect(body).not.toContain('anna@example.test');
  });

  it('te same filtry co lista trafiają do zapytania; nieznane wartości są pomijane', async () => {
    await POST(
      exportRequest(
        `format=json&entity=company&action=company.status_changed&id=${COMPANY}&from=2026-07-01&to=2026-07-31&actor=Anna`,
      ),
    );
    const [search] = fakeDb.callsTo('admin.audit-actor-search');
    expect(search?.values).toContain('%Anna%');
    const [list] = fakeDb.callsTo('admin.audit-logs');
    expect(list?.as).toBe('service');
    expect(list?.values).toEqual([
      'company',
      'company.status_changed',
      COMPANY,
      '2026-06-30T22:00:00.000Z',
      '2026-07-31T22:00:00.000Z',
      [ACTOR],
      10_001,
    ]);

    fakeDb.calls.length = 0;
    await POST(exportRequest('format=json&entity=evil&action=drop&id=nope&from=x&to=y'));
    const [unfiltered] = fakeDb.callsTo('admin.audit-logs');
    expect(unfiltered?.values).toEqual([10_001]);
    expect(unfiltered?.text).not.toContain('WHERE');
  });

  it('obcięcie w warstwie danych: limit+1 wierszy → limit wierszy i truncated=true', async () => {
    registerDefaults([logRow(1), logRow(2), logRow(3)]);
    const result = await exportAuditLogs({}, 'csv', 2);
    expect(result?.rows).toHaveLength(2);
    expect(result?.truncated).toBe(true);
    const [list] = fakeDb.callsTo('admin.audit-logs');
    expect(list?.values).toEqual([3]);
    // Kontrola ujemna: dokładnie `limit` wierszy to jeszcze nie obcięcie.
    resetFakeDb(ADMIN);
    registerDefaults([logRow(1), logRow(2)]);
    expect((await exportAuditLogs({}, 'csv', 2))?.truncated).toBe(false);
  });

  it('obcięcie w odpowiedzi: 10 001 wierszy → 10 000 w pliku, nagłówek, #truncated, flaga JSON', async () => {
    registerDefaults(Array.from({ length: 10_001 }, (_, i) => logRow(i + 1)));
    const csvResponse = await POST(exportRequest('format=csv'));
    expect(csvResponse.headers.get('x-export-truncated')).toBe('true');
    expect(csvResponse.headers.get('x-export-row-count')).toBe('10000');
    const lines = (await csvResponse.text()).trimEnd().split('\r\n');
    expect(lines).toHaveLength(1 + 10_000 + 1);
    expect(lines.at(-1)).toBe('#truncated,10000');

    const jsonResponse = await POST(exportRequest('format=json'));
    const json = (await jsonResponse.json()) as Record<string, unknown>;
    expect(json).toMatchObject({ truncated: true, limit: 10_000, rowCount: 10_000, timeZone: 'Europe/Brussels' });
    expect((json['rows'] as unknown[]).length).toBe(10_000);
  });

  it('każdy eksport zapisuje wpis audit_log.exported bez treści wpisów i bez frazy aktora', async () => {
    await POST(exportRequest('format=csv&actor=Anna&entity=company'));
    const [log] = fakeDb.callsTo('admin.audit-export-log');
    expect(log?.as).toBe('service');
    expect(log?.values[0]).toBe(ADMIN.id);
    expect(log?.values[1]).toBe('audit_log.exported');
    const after = JSON.parse(String(log?.values[2])) as Record<string, unknown>;
    expect(after).toEqual({
      format: 'csv',
      rowCount: 1,
      truncated: false,
      limit: 10_000,
      filters: { entity: 'company', action: null, entityId: false, actor: 'search', from: null, to: null },
    });
    const serialized = String(log?.values[2]);
    expect(serialized).not.toContain('Anna');
    expect(serialized).not.toContain('Brak danych');
    expect(serialized).not.toContain('Firma Test');

    await POST(exportRequest('format=json'));
    expect(fakeDb.callsTo('admin.audit-export-log')).toHaveLength(2);
  });
});

describe('formatowanie eksportu', () => {
  it('CSV neutralizuje formuły (= + - @) na początku komórki', () => {
    const rows = ['=HYPERLINK("http://x")', '+1+1', '-2+3', '@SUM(A1)'].map((reason, i) => ({
      id: String(i),
      action: 'company.status_changed',
      entityType: 'company',
      entityId: null,
      entityLabel: reason,
      statusBefore: null,
      statusAfter: null,
      reason,
      actorId: 'x',
      actorName: reason,
      createdAt: '2026-01-15T08:00:00.000Z',
    }));
    const csv = auditExportCsv(rows, { truncated: false, limit: 10 });
    const dataLines = csv.trimEnd().split('\r\n').slice(1);
    for (const line of dataLines) {
      const cells = line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/);
      for (const cell of cells.slice(4)) {
        if (!cell) continue;
        const unquoted = cell.startsWith('"') ? cell.slice(1, -1) : cell;
        expect(unquoted).not.toMatch(/^[=+\-@]/);
      }
    }
    expect(csv).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(csv).toContain("'@SUM(A1)");
  });

  it('kontrola ujemna: surowa komórka bez csvCell zostawiłaby formułę', () => {
    const raw = '=cmd|calc';
    expect(raw).toMatch(/^[=+\-@]/);
    expect(csvCell(raw)).toBe("'=cmd|calc");
  });

  it('czas w Europe/Brussels z przesunięciem (zima +01:00, lato +02:00)', () => {
    expect(toBrusselsIso('2026-01-15T08:00:00.000Z')).toBe('2026-01-15T09:00:00+01:00');
    expect(toBrusselsIso('2026-07-15T22:30:00.000Z')).toBe('2026-07-16T00:30:00+02:00');
    expect(toBrusselsIso('nie-data')).toBe('');
    expect(toBrusselsIso(null)).toBe('');
  });
});
