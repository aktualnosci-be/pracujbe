import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';
import { getPublicCategories, getPublicLocations } from '../../src/lib/db/public-dictionaries';
import { createRuntimePool } from '../../src/lib/db/pool';
import type { TransactionPool } from '../../src/lib/db/transaction';

const container = `pracujbe-dictionaries-test-${randomUUID()}`;
const password = randomUUID();
let created = false;
let admin: Pool | undefined;
let app: Pool | undefined;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 }).trim();
}

beforeAll(async () => {
  // Wyłącznie własny klaster i jawny port, bez połączenia do bazy aplikacji.
  docker('run', '--detach', '--rm', '--name', container, '--publish', '127.0.0.1::5432',
    '--tmpfs', '/var/lib/postgresql/data', '--env', `POSTGRES_PASSWORD=${password}`,
    '--env', 'POSTGRES_DB=dictionaries_test', 'postgres:16');
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1) throw new Error('Brak portu izolowanej bazy.');
  admin = new Pool({ host: '127.0.0.1', port, password, database: 'dictionaries_test', user: 'postgres', max: 1,
    connectionTimeoutMillis: 2_000 });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { await admin.query('SELECT 1'); ready = true; break; }
    catch { await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  const migrations = await loadProductionMigrations();
  const migrator = await admin.connect();
  try { expect((await applyMigrations(migrator, migrations)).applied).toBe(migrations.length); }
  finally { migrator.release(); }
  await admin.query(`CREATE ROLE dictionaries_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO dictionaries_web;
    -- Zastępujemy seed słowników tylko we własnej jednorazowej bazie fixture.
    DELETE FROM public.categories;
    DELETE FROM public.locations;
    INSERT INTO public.categories(key,name,icon,sort_order,is_active) VALUES
      ('warehouse','Magazyny','warehouse',2,true),
      ('construction','Budownictwo',null,1,true),
      ('cleaning','Sprzątanie','cleaning',2,true),
      ('transport','Nieaktywna branża','transport',0,false);
    INSERT INTO public.locations(slug,name,region,country,latitude,longitude,sort_order,is_active) VALUES
      ('antwerp','Antwerpen','Vlaanderen','BE',51.219448,4.402464,2,true),
      ('brussels','Bruxelles',null,'BE',50.850346,4.351721,1,true),
      ('ghent','Gent','Vlaanderen','BE',51.054342,3.717424,2,true),
      ('rotterdam','Rotterdam','Zuid-Holland','NL',51.924420,4.477733,3,true),
      ('hidden-city','Nieaktywne miasto',null,'BE',null,null,0,false);
    INSERT INTO public.companies(name,status,email,phone,address) VALUES
      ('Firma prywatna','verified','private@example.invalid','private-phone','private-address');`);
  app = await createRuntimePool(`postgresql://dictionaries_web:${password}@127.0.0.1:${port}/dictionaries_test`, 'domain');
});

afterAll(async () => {
  try { await app?.end(); }
  finally {
    try { await admin?.end(); }
    finally {
      if (created) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { docker('rm', '--force', container); } catch { /* sprawdzamy tylko własny kontener */ }
          if (!docker('ps', '-a', '--filter', `name=^/${container}$`, '--format', '{{.Names}}')) return;
          await new Promise(resolve => setTimeout(resolve, 250));
        }
        throw new Error('Nie udało się usunąć własnego kontenera testowego.');
      }
    }
  }
});

describe('Publiczne słowniki — pełne migracje i rzeczywisty PostgreSQL 16', () => {
  it('zwraca aktywne branże w stabilnej kolejności z kanoniczną nazwą i nullable ikoną', async () => {
    expect(await getPublicCategories(app!)).toEqual([
      { key: 'construction', name: 'Budownictwo', icon: null },
      { key: 'cleaning', name: 'Sprzątanie', icon: 'cleaning' },
      { key: 'warehouse', name: 'Magazyny', icon: 'warehouse' },
    ]);
  });

  it('zwraca aktywne lokalizacje i zachowuje nazwy kanoniczne dla fallbacku UI', async () => {
    expect(await getPublicLocations(app!)).toEqual([
      { slug: 'brussels', name: 'Bruxelles', region: null, country: 'BE' },
      { slug: 'antwerp', name: 'Antwerpen', region: 'Vlaanderen', country: 'BE' },
      { slug: 'ghent', name: 'Gent', region: 'Vlaanderen', country: 'BE' },
      { slug: 'rotterdam', name: 'Rotterdam', region: 'Zuid-Holland', country: 'NL' },
    ]);
  });

  it('filtruje klucze, pomija nieaktywne i zachowuje kolejność słownika zamiast wejścia', async () => {
    expect((await getPublicCategories(app!, { keys: ['warehouse', 'construction', 'transport', 'missing'] })).map(row => row.key))
      .toEqual(['construction', 'warehouse']);
    expect((await getPublicLocations(app!, { slugs: ['antwerp', 'brussels', 'hidden-city', 'missing'] })).map(row => row.slug))
      .toEqual(['brussels', 'antwerp']);
    expect(await getPublicCategories(app!, { keys: [] })).toEqual([]);
    expect(await getPublicLocations(app!, { slugs: [] })).toEqual([]);
  });

  it('łączy kraj z listą miast i nie tworzy nowego kanonicznego mapowania nazw', async () => {
    expect((await getPublicLocations(app!, { country: 'BE' })).map(row => row.slug)).toEqual(['brussels', 'antwerp', 'ghent']);
    expect((await getPublicLocations(app!, { country: 'NL', slugs: ['rotterdam', 'antwerp'] })).map(row => row.slug)).toEqual(['rotterdam']);
    expect(await getPublicLocations(app!, { country: 'XX' })).toEqual([]);
    expect(await getPublicLocations(app!, { slugs: ['Antwerpia'] })).toEqual([]);
  });

  it('oddaje tylko zadeklarowane pola referencyjne, bez metadanych i danych firm', async () => {
    for (const row of await getPublicCategories(app!)) expect(Object.keys(row).sort()).toEqual(['icon', 'key', 'name']);
    for (const row of await getPublicLocations(app!)) expect(Object.keys(row).sort()).toEqual(['country', 'name', 'region', 'slug']);
    await expect(app!.query('SELECT email,phone,address FROM public.companies')).rejects.toMatchObject({ code: '42501' });
    await expect(app!.query('SELECT token FROM auth.sessions')).rejects.toMatchObject({ code: '42501' });
  });

  it('parametryzuje tekst i tablice, również wartości przypominające SQL', async () => {
    const injection = "x'); DROP TABLE public.locations; --";
    expect(await getPublicCategories(app!, { keys: [injection] })).toEqual([]);
    expect(await getPublicLocations(app!, { slugs: [injection] })).toEqual([]);
    expect(await getPublicLocations(app!, { country: injection })).toEqual([]);
    expect((await admin!.query('SELECT count(*)::int AS count FROM public.locations')).rows[0]?.count).toBe(5);
    expect((await admin!.query('SELECT count(*)::int AS count FROM public.categories')).rows[0]?.count).toBe(4);
  });

  it('czyta jako anon z wyczyszczoną tożsamością, nawet na połączeniu użytym wcześniej przez użytkownika', async () => {
    const client = await app!.connect();
    const observed: { role: string; uid: string | null }[] = [];
    const reserved: TransactionPool = { connect: async () => ({
      query: async (sql, values) => {
        if (sql.startsWith('SELECT to_jsonb')) {
          const state = await client.query("SELECT current_user AS role, nullif(current_setting('app.current_uid',true),'') AS uid");
          observed.push(state.rows[0]);
        }
        return client.query(sql, values);
      },
      release: () => {},
    }) };
    try {
      await client.query('SET ROLE authenticated');
      await client.query("SELECT set_config('app.current_uid',$1,false)", [randomUUID()]);
      expect(await getPublicCategories(reserved)).toHaveLength(3);
      expect(await getPublicLocations(reserved)).toHaveLength(4);
      expect(observed).toEqual([{ role: 'anon', uid: null }, { role: 'anon', uid: null }]);
    } finally {
      try { await client.query('RESET ROLE; RESET app.current_uid'); }
      finally { client.release(); }
    }
  });

  it('propaguje brak uprawnień zamiast udawać pusty słownik lub dane demo', async () => {
    await admin!.query('REVOKE SELECT ON public.categories FROM anon');
    try { await expect(getPublicCategories(app!)).rejects.toMatchObject({ code: '42501' }); }
    finally { await admin!.query('GRANT SELECT ON public.categories TO anon'); }
    expect(await getPublicCategories(app!)).toHaveLength(3);
  });
});
