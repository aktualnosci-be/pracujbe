import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadProductionMigrations } from '../../scripts/db/production-migrations.mjs';
import { applyMigrations } from '../../scripts/db/migrate.mjs';
import {
  getPublicJob,
  getPublicJobFilterFacets,
  getPublicJobTranslations,
  getPublicJobs,
  getPublicJobsCount,
} from '../../src/lib/db/public-jobs';
import { createRuntimePool } from '../../src/lib/db/pool';
import type { TransactionPool } from '../../src/lib/db/transaction';
import type { GetJobsParams } from '../../src/lib/jobs';

const container = `pracujbe-public-jobs-test-${randomUUID()}`;
const password = randomUUID();
const companyId = randomUUID();
const unpublishedCompanyId = randomUUID();
const deletedCompanyId = randomUUID();
const richJobId = randomUUID();
const now = new Date();
const daysAgo = (days: number) =>
  new Date(now.getTime() - days * 86_400_000).toISOString();
const expiresAt = daysAgo(-30);
let created = false;
let admin: Pool | undefined;
let app: Pool | undefined;

function docker(...args: string[]): string {
  const windows = process.platform === 'win32';
  return execFileSync(
    windows ? 'wsl.exe' : 'docker',
    windows ? ['-d', 'Ubuntu', '--', 'docker', ...args] : args,
    { encoding: 'utf8', timeout: 60_000 },
  ).trim();
}

const visibleSlugs = [
  'warehouse-rich',
  'transport',
  'without-salary',
  'fallback-default',
  'fallback-en',
  'canonical',
];
const hiddenSlugs = [
  'draft',
  'expired-date',
  'expired-status',
  'deleted-job',
  'unverified-company',
  'deleted-company',
];

beforeAll(async () => {
  // Wyłącznie własna jednorazowa baza z jawnym portem, bez DATABASE_URL z otoczenia.
  docker(
    'run',
    '--detach',
    '--rm',
    '--name',
    container,
    '--publish',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql/data',
    '--env',
    `POSTGRES_PASSWORD=${password}`,
    '--env',
    'POSTGRES_DB=public_jobs_test',
    'postgres:16',
  );
  created = true;
  const port = Number(docker('port', container, '5432/tcp').split(':').at(-1));
  if (!Number.isInteger(port) || port < 1)
    throw new Error('Brak portu izolowanej bazy.');
  admin = new Pool({
    host: '127.0.0.1',
    port,
    password,
    database: 'public_jobs_test',
    user: 'postgres',
    max: 1,
    connectionTimeoutMillis: 2_000,
  });
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await admin.query('SELECT 1');
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  if (!ready) throw new Error('Izolowany PostgreSQL nie uruchomił się.');
  const migrations = await loadProductionMigrations();
  const migrator = await admin.connect();
  try {
    expect((await applyMigrations(migrator, migrations)).applied).toBe(
      migrations.length,
    );
  } finally {
    migrator.release();
  }
  await admin.query(`CREATE ROLE public_jobs_web LOGIN PASSWORD '${password}'
    NOINHERIT NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE;
    GRANT pracujbe_app TO public_jobs_web;`);
  app = await createRuntimePool(
    `postgresql://public_jobs_web:${password}@127.0.0.1:${port}/public_jobs_test`,
    'domain',
  );

  await admin.query(
    `INSERT INTO public.companies(id,name,status,description,email,phone,address,deleted_at)
    VALUES ($1,'Firma publiczna','verified','Publiczny opis firmy','private@example.invalid','private-phone','private-address',null),
      ($2,'Firma niezweryfikowana','unverified',null,null,null,null,null),
      ($3,'Firma usunięta','verified',null,null,null,null,now())`,
    [companyId, unpublishedCompanyId, deletedCompanyId],
  );

  const fixtures = [
    {
      slug: 'warehouse-rich',
      category: 'warehouse',
      contract: 'permanent',
      city: 'Antwerp',
      min: 3000,
      max: 3500,
      accommodation: true,
      immediate: true,
      noLanguage: true,
      locale: 'nl',
    },
    {
      slug: 'transport',
      category: 'transport',
      contract: 'temporary',
      city: 'Ghent',
      min: 4000,
      max: 4500,
    },
    {
      slug: 'without-salary',
      category: 'construction',
      contract: 'interim',
      city: 'Antwerp',
      accommodation: true,
      noLanguage: true,
    },
    {
      slug: 'fallback-default',
      category: 'warehouse',
      contract: 'permanent',
      city: 'Brussels',
      min: 2500,
      max: 2700,
      locale: 'nl',
    },
    {
      slug: 'fallback-en',
      category: 'cleaning',
      contract: 'permanent',
      city: 'Leuven',
      min: 2000,
      max: 2200,
      locale: 'fr',
    },
    {
      slug: 'canonical',
      category: 'technical',
      contract: 'permanent',
      city: 'Leuven',
      min: 1800,
      max: 2100,
    },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    await admin.query(
      `INSERT INTO public.jobs(id,company_id,slug,title,status,category,contract_type,city,region,
      salary_min,salary_max,salary_period,published_at,expires_at,accommodation,immediate,no_language_required,
      default_locale,transport,start_date,working_hours,shifts,contact_email,address)
      VALUES ($1,$2,$3,$4,'active',$5,$6,$7,'Flandria',$8,$9,'hour',$10,$11,$12,$13,$14,$15,true,
        '2026-10-01','40 godzin','Dzienna','private-job@example.invalid','private-job-address')`,
      [
        index === 0 ? richJobId : randomUUID(),
        companyId,
        fixture.slug,
        `Tytuł bazowy ${fixture.slug}`,
        fixture.category,
        fixture.contract,
        fixture.city,
        fixture.min ?? null,
        fixture.max ?? null,
        daysAgo(index + 1),
        expiresAt,
        fixture.accommodation ?? false,
        fixture.immediate ?? false,
        fixture.noLanguage ?? false,
        fixture.locale ?? 'pl',
      ],
    );
  }
  for (const slug of hiddenSlugs) {
    await admin.query(
      `INSERT INTO public.jobs(company_id,slug,title,status,category,contract_type,city,region,
      published_at,expires_at,deleted_at)
      VALUES ($1,$2,'Oferta ukryta',$3,'warehouse','permanent','Antwerp','Flandria',$4,$5,$6)`,
      [
        slug === 'unverified-company'
          ? unpublishedCompanyId
          : slug === 'deleted-company'
            ? deletedCompanyId
            : companyId,
        slug,
        slug === 'draft'
          ? 'draft'
          : slug === 'expired-status'
            ? 'expired'
            : 'active',
        daysAgo(0),
        slug === 'expired-date' ? daysAgo(1) : expiresAt,
        slug === 'deleted-job' ? daysAgo(1) : null,
      ],
    );
  }

  for (const [locale, title] of Object.entries({
    pl: 'Magazynier PL',
    nl: 'Magazijn NL',
    fr: 'Magasin FR',
    en: 'Warehouse EN',
  })) {
    await admin.query(
      `INSERT INTO public.job_translations(job_id,locale,title,description,responsibilities,
      conditions,highlights,company_description)
      VALUES ($1,$2,$3,$4,ARRAY[$5],ARRAY[$6],ARRAY[$7],$8)`,
      [
        richJobId,
        locale,
        title,
        `Opis ${locale}`,
        `Obowiązek ${locale}`,
        `Warunek ${locale}`,
        `Atut ${locale}`,
        `Firma ${locale}`,
      ],
    );
  }
  await admin.query(`INSERT INTO public.job_translations(job_id,locale,title)
    SELECT id,'nl','Domyślny NL' FROM public.jobs WHERE slug='fallback-default'
    UNION ALL SELECT id,'en','Fallback EN' FROM public.jobs WHERE slug IN ('fallback-default','fallback-en');
    INSERT INTO public.job_requirements(job_id,locale,kind,position,content)
    SELECT id,'nl','mandatory'::public.requirement_kind,1,'Wymaganie NL' FROM public.jobs WHERE slug='warehouse-rich'
    UNION ALL SELECT id,'pl','mandatory'::public.requirement_kind,1,'Wymaganie PL' FROM public.jobs WHERE slug='warehouse-rich';
    INSERT INTO public.job_languages(job_id,language_label)
    SELECT id,'Niderlandzki' FROM public.jobs WHERE slug='warehouse-rich';`);
});

afterAll(async () => {
  try {
    await app?.end();
  } finally {
    try {
      await admin?.end();
    } finally {
      if (created) {
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            docker('rm', '--force', container);
          } catch {
            /* sprawdzamy własną nazwę poniżej */
          }
          if (
            !docker(
              'ps',
              '-a',
              '--filter',
              `name=^/${container}$`,
              '--format',
              '{{.Names}}',
            )
          )
            return;
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        throw new Error('Nie udało się usunąć własnego kontenera testowego.');
      }
    }
  }
});

describe('Publiczne oferty — pełne migracje i rzeczywisty PostgreSQL 16', () => {
  it('pokazuje wyłącznie aktywne niewygasłe oferty zweryfikowanych istniejących firm', async () => {
    const result = await getPublicJobs(app!, { locale: 'pl' });
    expect(result.rows.map((row) => row.slug)).toEqual(visibleSlugs);
    expect(result).toMatchObject({ total: 6, page: 1, pageSize: 12 });
    expect(await getPublicJobsCount(app!, { locale: 'pl' })).toBe(6);
    for (const slug of hiddenSlugs)
      expect(await getPublicJob(app!, slug, 'pl')).toBeNull();
  });

  it.each([
    ['pl', 'Magazynier PL'],
    ['nl', 'Magazijn NL'],
    ['fr', 'Magasin FR'],
    ['en', 'Warehouse EN'],
    ['unsupported', 'Magazynier PL'],
  ])('zachowuje język %s listy i detalu', async (locale, title) => {
    const result = await getPublicJobs(app!, { locale });
    expect(result.rows[0]?.title).toBe(title);
    expect((await getPublicJob(app!, 'warehouse-rich', locale))?.title).toBe(
      title,
    );
  });

  it('stosuje fallback do języka oferty, potem angielskiego i tytułu bazowego', async () => {
    const result = await getPublicJobs(app!, { locale: 'fr' });
    for (const [slug, title] of [
      ['fallback-default', 'Domyślny NL'],
      ['fallback-en', 'Fallback EN'],
      ['canonical', 'Tytuł bazowy canonical'],
    ]) {
      expect(result.rows.find((row) => row.slug === slug)?.title).toBe(title);
      expect((await getPublicJob(app!, slug!, 'fr'))?.title).toBe(title);
    }
    expect(
      (await getPublicJob(app!, 'warehouse-rich', 'fr'))
        ?.requirements_mandatory,
    ).toEqual(['Wymaganie NL']);
  });

  it('udostępnia gościowi języki tłumaczeń tylko ofert publicznych (#301)', async () => {
    const ids = (
      await admin!.query<{ id: string; slug: string }>(
        `SELECT id::text, slug FROM public.jobs WHERE slug = ANY($1::text[])`,
        [['warehouse-rich', 'fallback-default', 'canonical', 'draft']],
      )
    ).rows;
    const idOf = (slug: string) => ids.find((row) => row.slug === slug)!.id;
    await admin!.query(
      `INSERT INTO public.job_translations(job_id,locale,title) VALUES ($1,'pl','Szkic ukryty')`,
      [idOf('draft')],
    );

    const rows = await getPublicJobTranslations(app!, ids.map((row) => row.id));
    const localesOf = (slug: string) =>
      rows.filter((row) => row.job_id === idOf(slug)).map((row) => row.locale).sort();

    expect(localesOf('warehouse-rich')).toEqual(['en', 'fr', 'nl', 'pl']);
    expect(localesOf('fallback-default')).toEqual(['en', 'nl']);
    expect(localesOf('canonical')).toEqual([]);
    expect(localesOf('draft')).toEqual([]);
    expect(rows.find((row) => row.job_id === idOf('fallback-default') && row.locale === 'nl')?.title).toBe(
      'Domyślny NL',
    );
  });

  const filters: [string, Partial<GetJobsParams>, string[]][] = [
    ['kategoria pojedyncza', { category: 'transport' }, ['transport']],
    [
      'kategorie',
      { categories: ['warehouse'] },
      ['warehouse-rich', 'fallback-default'],
    ],
    [
      'pierwszeństwo tablicy',
      { category: 'warehouse', categories: ['cleaning'] },
      ['fallback-en'],
    ],
    ['umowa pojedyncza', { contractType: 'temporary' }, ['transport']],
    ['umowy', { contractTypes: ['interim'] }, ['without-salary']],
    [
      'miasta',
      { locations: ['Antwerp'] },
      ['warehouse-rich', 'without-salary'],
    ],
    ['fragment miasta', { city: 'Ant' }, ['warehouse-rich', 'without-salary']],
    ['słowo', { keyword: 'magazynier' }, ['warehouse-rich']],
    [
      'słowo w języku odbiorcy',
      { locale: 'en', keyword: 'warehouse' },
      ['warehouse-rich'],
    ],
    [
      'przedział pensji',
      { salaryMin: 3200, salaryMax: 3600 },
      ['warehouse-rich', 'without-salary'],
    ],
    ['pensja nie wyklucza niepodanej', { salaryMin: 5000 }, ['without-salary']],
    [
      'pensja maksymalna',
      { salaryMax: 2200 },
      ['without-salary', 'fallback-en', 'canonical'],
    ],
    [
      'zakwaterowanie',
      { accommodation: true },
      ['warehouse-rich', 'without-salary'],
    ],
    [
      'bez zakwaterowania',
      { accommodation: false },
      ['transport', 'fallback-default', 'fallback-en', 'canonical'],
    ],
    ['od zaraz', { immediate: true }, ['warehouse-rich']],
    ['false nie filtruje od zaraz', { immediate: false }, visibleSlugs],
    [
      'bez języka',
      { noLanguageRequired: true },
      ['warehouse-rich', 'without-salary'],
    ],
    ['data', { since: daysAgo(2.5) }, ['warehouse-rich', 'transport']],
    [
      'razem',
      {
        categories: ['warehouse'],
        contractTypes: ['permanent'],
        locations: ['Antwerp'],
        salaryMin: 3000,
        salaryMax: 3500,
        accommodation: true,
        immediate: true,
        noLanguageRequired: true,
        since: daysAgo(1.5),
        keyword: 'Magazynier',
        city: 'Ant',
      },
      ['warehouse-rich'],
    ],
    ['brak wyników', { keyword: 'nieistniejący tytuł' }, []],
  ];
  it.each(filters)(
    'filtr %s daje ten sam wynik listy i licznika',
    async (_label, filter, slugs) => {
    const params = { locale: 'pl', ...filter };
    const result = await getPublicJobs(app!, params);
      expect(result.rows.map((row) => row.slug)).toEqual(slugs);
    expect(result.total).toBe(slugs.length);
    expect(Number.isSafeInteger(result.total)).toBe(true);
    expect(await getPublicJobsCount(app!, params)).toBe(slugs.length);
    },
  );

  it('sortuje i stronicuje w SQL, a licznik obejmuje również pozostałe strony', async () => {
    const salary = await getPublicJobs(app!, { locale: 'pl', sort: 'salary' });
    expect(salary.rows.map((row) => row.slug)).toEqual([
      'transport',
      'warehouse-rich',
      'fallback-default',
      'fallback-en',
      'canonical',
      'without-salary',
    ]);
    const page = await getPublicJobs(app!, {
      locale: 'pl',
      page: 2,
      pageSize: 2,
    });
    expect(page.rows.map((row) => row.slug)).toEqual([
      'without-salary',
      'fallback-default',
    ]);
    expect(page).toMatchObject({ total: 6, page: 2, pageSize: 2 });
    expect(
      await getPublicJobs(app!, { locale: 'pl', page: 4, pageSize: 2 }),
    ).toMatchObject({ rows: [], total: 6 });
  });

  it('normalizuje nieprawidłową paginację i nakłada sufit SQL bez przepełnienia', async () => {
    expect(
      await getPublicJobs(app!, {
        locale: 'pl',
        page: Number.NaN,
        pageSize: Number.POSITIVE_INFINITY,
      }),
    ).toMatchObject({ page: 1, pageSize: 12, total: 6 });
    expect(
      await getPublicJobs(app!, { locale: 'pl', page: -2, pageSize: -3 }),
    ).toMatchObject({ page: 1, pageSize: 1 });
    expect(
      await getPublicJobs(app!, { locale: 'pl', page: 1.9, pageSize: 1000 }),
    ).toMatchObject({ page: 1, pageSize: 100 });
    expect(
      await getPublicJobs(app!, {
        locale: 'pl',
        page: Number.MAX_VALUE,
        pageSize: 100,
      }),
    ).toMatchObject({ rows: [], total: 6 });
  });

  it('zachowuje kontrakt JSON dat, liczb, null i tablic oraz nie ujawnia prywatnych pól', async () => {
    const detail = await getPublicJob(app!, 'warehouse-rich', 'pl');
    expect(detail).toMatchObject({
      salary_min: 3000,
      salary_max: 3500,
      salary_period: 'hour',
      start_date: '2026-10-01',
      description: 'Opis pl',
      responsibilities: ['Obowiązek pl'],
      conditions: ['Warunek pl'],
      requirements_mandatory: ['Wymaganie PL'],
      requirements_optional: [],
      languages: ['Niderlandzki'],
      transport: true,
      company_description: 'Firma pl',
      working_hours: '40 godzin',
      shifts: 'Dzienna',
    });
    expect(typeof detail?.published_at).toBe('string');
    expect(typeof detail?.expires_at).toBe('string');
    expect(Date.parse(detail!.published_at as string)).toBe(
      Date.parse(daysAgo(1)),
    );
    expect(Date.parse(detail!.expires_at as string)).toBe(
      Date.parse(expiresAt),
    );
    expect(
      (await getPublicJob(app!, 'without-salary', 'pl'))?.salary_min,
    ).toBeNull();
    const list = await getPublicJobs(app!, { locale: 'pl' });
    expect(
      list.rows.find((row) => row.slug === 'warehouse-rich'),
    ).toMatchObject({ salary_period: 'hour' });
    for (const row of [...list.rows, detail!]) {
      expect(JSON.stringify(row)).not.toContain('private');
      for (const field of [
        'company_id',
        'created_by',
        'contact_email',
        'email',
        'phone',
        'address',
        'vat_number',
        'status',
        'created_at',
        'updated_at',
        'views_count',
        'applications_count',
      ])
        expect(row).not.toHaveProperty(field);
    }
  });

  it('przekazuje teksty i tablice jako parametry, także gdy wyglądają jak SQL', async () => {
    const input = "x'); DROP TABLE public.jobs; --";
    expect(await getPublicJob(app!, input, 'pl')).toBeNull();
    for (const filter of [
      { keyword: input },
      { city: input },
      { locations: [input] },
      { categories: [input] },
      { contractTypes: [input] },
    ]) {
      const params = { locale: 'pl', ...filter } as GetJobsParams;
      expect(await getPublicJobs(app!, params)).toMatchObject({
        rows: [],
        total: 0,
      });
      expect(await getPublicJobsCount(app!, params)).toBe(0);
    }
    expect((await getPublicJobs(app!, { locale: input })).rows[0]?.title).toBe(
      'Magazynier PL',
    );
    expect(
      (await admin!.query('SELECT count(*)::int AS count FROM public.jobs'))
        .rows[0]?.count,
    ).toBe(12);
  });

  it('wykonuje każdy odczyt jako anon z pustą tożsamością i nie daje dostępu do tabel bazowych', async () => {
    const observed: { role: string; uid: string | null }[] = [];
    const checkedPool: TransactionPool = {
      connect: async () => {
      const client = await app!.connect();
      return {
        query: async (sql, values) => {
          if (sql.startsWith('SELECT to_jsonb')) {
              const state = await client.query(
                "SELECT current_user AS role, nullif(current_setting('app.current_uid',true),'') AS uid",
              );
            observed.push(state.rows[0]);
          }
          return client.query(sql, values);
        },
        release: (destroy) => client.release(destroy),
      };
      },
    };
    await getPublicJobs(checkedPool, { locale: 'pl' });
    await getPublicJobsCount(checkedPool, { locale: 'pl' });
    await getPublicJob(checkedPool, 'warehouse-rich', 'pl');
    expect(observed).toHaveLength(4);
    expect(
      observed.every((state) => state.role === 'anon' && state.uid === null),
    ).toBe(true);
    await expect(app!.query('SELECT * FROM public.jobs')).rejects.toMatchObject(
      { code: '42501' },
    );
    await expect(
      app!.query('SELECT token FROM auth.sessions'),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('liczy pełne facety powyżej 200 i zachowuje pozostałe aktywne filtry', async () => {
    await admin!.query(
      `insert into public.jobs(company_id,slug,title,status,category,contract_type,city,region,
      published_at,expires_at,accommodation,immediate,no_language_required)
      select $1,'facet-'||n,'Facet '||n,'active','warehouse','permanent','Antwerp','Flandria',now(),now()+interval '30 days',
        n%2=0,n%3=0,n%5=0 from generate_series(1,205) n`,
      [companyId],
    );
    try {
      const facets = await getPublicJobFilterFacets(app!, {
        locale: 'pl',
        contractTypes: ['permanent'],
        locations: ['Antwerp'],
      });
      expect(facets.total).toBe(206);
      expect(facets.categories['warehouse']).toBe(206);
      expect(facets.locations).toContainEqual({ city: 'Antwerp', count: 206 });
      expect(facets.contracts['permanent']).toBe(206);
      expect(
        facets.accommodation.provided + facets.accommodation.unavailable,
      ).toBe(206);
      expect(facets.immediate).toBeGreaterThan(60);
      expect(facets.noLanguage).toBeGreaterThan(40);
      await expect(
        app!.query('select count(*) from public.jobs'),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await admin!.query(`delete from public.jobs where slug like 'facet-%'`);
    }
  });

  it('propaguje awarię RPC zamiast podstawiać pustą listę lub dane demo', async () => {
    await admin!.query(
      'REVOKE EXECUTE ON FUNCTION public.get_public_job(text,text) FROM anon',
    );
    try {
      await expect(
        getPublicJob(app!, 'warehouse-rich', 'pl'),
      ).rejects.toMatchObject({ code: '42501' });
    } finally {
      await admin!.query(
        'GRANT EXECUTE ON FUNCTION public.get_public_job(text,text) TO anon',
      );
    }
    expect((await getPublicJob(app!, 'warehouse-rich', 'pl'))?.id).toBe(
      richJobId,
    );
  });
});
