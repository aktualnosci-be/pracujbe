import { describe, expect, it } from 'vitest';
import {
  E2E_DEFAULT_PORTS,
  e2eBasePort,
  e2eBaseUrl,
  e2ePort,
  e2eReuseServer,
} from '../../scripts/lib/e2e-server.mjs';

const kinds = Object.keys(E2E_DEFAULT_PORTS) as (keyof typeof E2E_DEFAULT_PORTS)[];

describe('porty serwera E2E (E2E_PORT)', () => {
  it('bez E2E_PORT porty są takie jak dotąd (CI bez zmian)', () => {
    expect(e2ePort('demo', {})).toBe(3000);
    expect(e2ePort('fixtureFull', {})).toBe(4319);
    expect(e2ePort('fixtureError', {})).toBe(4320);
    expect(e2ePort('realFlow', {})).toBe(4331);
    expect(e2ePort('perfLab', {})).toBe(3100);
    expect(e2eBaseUrl('demo', { env: {} })).toBe('http://localhost:3000');
    expect(e2eBasePort({ E2E_PORT: '  ' })).toBeUndefined();
  });

  it('E2E_PORT przesuwa wszystkie konfiguracje do własnego slotu', () => {
    const env = { E2E_PORT: '3517' };
    expect(e2ePort('demo', env)).toBe(3517);
    expect(e2ePort('fixtureFull', env)).toBe(3518);
    expect(e2ePort('fixtureError', env)).toBe(3519);
    expect(e2ePort('realFlow', env)).toBe(3520);
    expect(e2ePort('perfLab', env)).toBe(3617);
    expect(e2eBaseUrl('realFlow', { host: '127.0.0.1', env })).toBe('http://127.0.0.1:3520');
  });

  it('porty w slocie są różne, a slot przesunięty o 101 nie zachodzi na poprzedni', () => {
    const slot = (base: number) => kinds.map((kind) => e2ePort(kind, { E2E_PORT: String(base) }));
    const first = slot(3517);
    expect(new Set(first).size).toBe(kinds.length);
    expect(first.filter((port) => slot(3517 + 101).includes(port))).toEqual([]);
    // Kontrola ujemna: slot przesunięty tylko o 100 koliduje (lab CWV = demo następnego slotu).
    expect(first.filter((port) => slot(3617).includes(port))).toEqual([3617]);
  });

  it('nieprawidłowy E2E_PORT to błąd, nie cichy powrót do 3000', () => {
    for (const value of ['abc', '3000x', '-1', '80', '65500', '3.5']) {
      expect(() => e2ePort('demo', { E2E_PORT: value }), value).toThrow(/E2E_PORT/);
    }
  });

  it('serwer już działający na porcie tylko przy jawnym E2E_REUSE_SERVER=1 i nigdy w CI', () => {
    expect(e2eReuseServer({})).toBe(false);
    expect(e2eReuseServer({ E2E_REUSE_SERVER: 'true' })).toBe(false);
    expect(e2eReuseServer({ E2E_REUSE_SERVER: '1' })).toBe(true);
    expect(e2eReuseServer({ E2E_REUSE_SERVER: '1', CI: 'true' })).toBe(false);
  });
});
