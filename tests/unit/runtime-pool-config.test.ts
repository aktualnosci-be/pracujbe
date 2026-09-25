import { describe, expect, it } from 'vitest';
import { runtimePoolConfig } from '@/lib/db/pool';

describe('Konfiguracja ograniczonej puli', () => {
  it('ustawia rolę i schemat dla każdego nowego połączenia auth', () => {
    const config = runtimePoolConfig('postgresql://auth_login:secret@localhost:5433/app', 'auth');
    expect(config.options).toContain('-c role=pracujbe_auth -c search_path=auth');
    expect(config.max).toBe(5);
    expect(config.connectionTimeoutMillis).toBe(10_000);
  });
  it('oddziela pulę domenową od tabel poświadczeń', () => {
    expect(runtimePoolConfig('postgres://web:secret@localhost/app', 'domain').options)
      .toContain('-c role=pracujbe_app -c search_path=public');
  });
  it('pula monitoringu (#47): rola pracujbe_ops i jedna sesja', () => {
    const config = runtimePoolConfig('postgres://ops:secret@localhost/app', 'ops');
    expect(config.options).toContain('-c role=pracujbe_ops -c search_path=public');
    expect(config.max).toBe(1);
  });
  it('pula limitera (0058) i workera poczty auth (0061): własne role, mało sesji', () => {
    const limiter = runtimePoolConfig('postgres://limiter:secret@localhost/app', 'rate_limit');
    expect(limiter.options).toContain('-c role=pracujbe_rate_limit -c search_path=public');
    expect(limiter.max).toBe(2);
    const mail = runtimePoolConfig('postgres://mail:secret@localhost/app', 'auth_mail');
    expect(mail.options).toContain('-c role=pracujbe_auth_mail -c search_path=auth');
    expect(mail.max).toBe(2);
  });
  it.each([
    '', 'not-a-url', 'https://user:secret@host/db', 'postgres://host/db',
    'postgres://user:secret@host/',
    'postgres://user:secret@host/db?options=-c%20role=postgres',
    'postgres://user:secret@host/db?sslmode=no-verify',
    'postgres://user:secret@host/db?user=postgres',
  ])('odrzuca niepełną lub nadpisującą uprawnienia konfigurację', value => {
    expect(() => runtimePoolConfig(value, 'domain')).toThrow();
    try { runtimePoolConfig(value, 'domain'); }
    catch (error) { expect(String(error)).not.toContain('secret'); }
  });
});
