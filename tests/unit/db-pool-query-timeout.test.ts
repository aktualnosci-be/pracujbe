// @vitest-environment node
import { createServer, type Server, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import { Pool } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CLIENT_QUERY_TIMEOUT_MS,
  KEEP_ALIVE_INITIAL_DELAY_MS,
  STATEMENT_TIMEOUT_MS,
  runtimePoolConfig,
} from '@/lib/db/pool';

/**
 * #1229 — pule PostgreSQL mają kliencki `query_timeout` i TCP keepalive. Serwer testowy
 * odgrywa „półotwarte” połączenie: kończy handshake (AuthenticationOk + ReadyForQuery),
 * a potem NIGDY nie odpowiada na zapytanie. Bez `query_timeout` `pool.query` wisi bez końca
 * (kontrola ujemna), więc single-flight `/api/health` trzymałby tę obietnicę wiecznie.
 */

let server: Server;
let port = 0;
let queries = 0;
const sockets = new Set<Socket>();

function frame(type: string, body: Buffer): Buffer {
  const header = Buffer.alloc(5);
  header.write(type, 0, 'ascii');
  header.writeInt32BE(body.length + 4, 1);
  return Buffer.concat([header, body]);
}

beforeAll(async () => {
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    let started = false;
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (!started) {
          if (buffer.length < 4) return;
          const len = buffer.readInt32BE(0);
          if (buffer.length < len) return;
          buffer = buffer.subarray(len);
          started = true;
          const auth = Buffer.alloc(4);
          auth.writeInt32BE(0, 0);
          socket.write(Buffer.concat([frame('R', auth), frame('Z', Buffer.from('I'))]));
          continue;
        }
        if (buffer.length < 5) return;
        const len = buffer.readInt32BE(1);
        if (buffer.length < len + 1) return;
        const type = String.fromCharCode(buffer[0]!);
        buffer = buffer.subarray(len + 1);
        if (type === 'Q' || type === 'P') queries += 1;
        // Brak odpowiedzi — serwer „zniknął” bez RST.
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  queries = 0;
});

function url() {
  return `postgres://web@127.0.0.1:${port}/app`;
}

describe('konfiguracja puli (#1229)', () => {
  it.each(['domain', 'auth', 'ops', 'rate_limit', 'auth_mail', 'service'] as const)(
    'pula %s: query_timeout dłuższy od statement_timeout i keepalive',
    (purpose) => {
      const config = runtimePoolConfig(url(), purpose);
      expect(config.query_timeout).toBe(CLIENT_QUERY_TIMEOUT_MS);
      expect(CLIENT_QUERY_TIMEOUT_MS).toBeGreaterThan(STATEMENT_TIMEOUT_MS);
      expect(config.options).toContain(`statement_timeout=${STATEMENT_TIMEOUT_MS}`);
      expect(config.keepAlive).toBe(true);
      expect(config.keepAliveInitialDelayMillis).toBe(KEEP_ALIVE_INITIAL_DELAY_MS);
    },
  );
});

describe('zawieszone połączenie (#1229)', () => {
  it('z query_timeout zapytanie się rozstrzyga błędem', async () => {
    const pool = new Pool({ ...runtimePoolConfig(url(), 'domain'), query_timeout: 150 });
    pool.on('error', () => {});
    try {
      await expect(pool.query('SELECT 1 AS ok')).rejects.toThrow();
      expect(queries).toBe(1);
    } finally {
      await pool.end().catch(() => {});
    }
  });

  it('kontrola ujemna: bez query_timeout zapytanie wisi', async () => {
    const config = { ...runtimePoolConfig(url(), 'domain') };
    delete config.query_timeout;
    const pool = new Pool(config);
    pool.on('error', () => {});
    let settled = false;
    const pending = pool.query('SELECT 1 AS ok').then(
      () => { settled = true; },
      () => { settled = true; },
    );
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(settled).toBe(false);
    for (const socket of sockets) socket.destroy();
    await pending;
    await pool.end().catch(() => {});
  });
});

describe('single-flight /api/health nie wisi na zawieszonym połączeniu (#1229)', () => {
  const holder = vi.hoisted(() => ({ pool: null as unknown }));
  vi.mock('@/lib/db/runtime', () => ({ getDomainPool: async () => holder.pool }));

  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('APP_MODE', 'demo');
    vi.stubEnv('DATABASE_APP_URL', 'postgres://example/db');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('po query_timeout kolejne żądanie wysyła nowe zapytanie (wpis inFlight zwolniony)', async () => {
    const pool = new Pool({ ...runtimePoolConfig(url(), 'domain'), query_timeout: 2_500 });
    pool.on('error', () => {});
    holder.pool = pool;
    try {
      const { GET } = await import('@/app/api/health/route');
      const first = await GET(new Request('https://pracuj.be/api/health'));
      expect(first.status).toBe(503); // lokalny limit 2 s żądania
      // zapytanie nadal trwa → drugie żądanie w tym oknie nie otwiera nowego
      const second = await GET(new Request('https://pracuj.be/api/health'));
      expect(second.status).toBe(503);
      expect(queries).toBe(1);
      // po query_timeout wpis inFlight znika — kolejne żądanie znów pyta bazę
      await new Promise((resolve) => setTimeout(resolve, 600));
      const third = GET(new Request('https://pracuj.be/api/health'));
      await new Promise((resolve) => setTimeout(resolve, 200));
      expect(queries).toBe(2);
      expect((await third).status).toBe(503);
    } finally {
      await pool.end().catch(() => {});
    }
  }, 15_000);
});
