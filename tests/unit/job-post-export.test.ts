import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  buildPostContent,
  escapeXml,
  exportJobPost,
  layoutPost,
  renderSvg,
} from '../../scripts/export-job-post.mjs';
import { launchChromium } from '../../scripts/lib/launch-chromium.mjs';
import {
  JobUnavailableError,
  assertRestrictedLogin,
  createAnonJobQuery,
  loadExportableJob,
} from '../../scripts/lib/job-post-source.mjs';
import { decodePng } from '../helpers/png-pixels';

const execFileAsync = promisify(execFile);
const SCRIPT = resolve('scripts/export-job-post.mjs');
const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;

type Row = Record<string, unknown>;

const ROW: Row = {
  slug: 'operator-wozka-widlowego-antwerpia',
  title: 'Operator wózka widłowego',
  company_name: 'Logistyka Noord NV',
  city: 'Antwerpia',
  region: 'Flandria',
  contract_type: 'permanent',
  accommodation: true,
  salary_min: 17,
  salary_max: 20,
  currency: 'EUR',
  salary_period: 'hour',
};

function load(row: Row | null, locale: string = 'pl', slug = ROW.slug as string) {
  const query = vi.fn(async () => (row ? [row] : []));
  return { query, job: loadExportableJob({ slug, locale, query }) };
}

/** Pomiar deterministyczny do testów układu: 0,6 szerokości znaku na piksel rozmiaru. */
const fakeMeasure = async (text: string, font: string) => {
  const size = Number(/(\d+)px/.exec(font)?.[1] ?? 16);
  return Array.from(text).length * size * 0.6;
};

async function svgFor(row: Row, locale: string = 'pl') {
  const job = await load(row, locale).job;
  const content = buildPostContent(job);
  return renderSvg(content, await layoutPost(content, fakeMeasure));
}

describe('źródło oferty posta (#186): tylko get_campaign_job pod rolą anon', () => {
  it('zwraca wąski zestaw pól i bezpieczny adres oferty', async () => {
    const job = await load(ROW, 'nl').job;
    expect(job).toEqual({
      slug: ROW.slug,
      locale: 'nl',
      url: 'https://pracuj.be/nl/oferty-pracy/operator-wozka-widlowego-antwerpia',
      title: 'Operator wózka widłowego',
      companyName: 'Logistyka Noord NV',
      city: 'Antwerpia',
      region: 'Flandria',
      contractType: 'permanent',
      accommodation: true,
      salaryMin: 17,
      salaryMax: 20,
      currency: 'EUR',
      salaryPeriod: 'hour',
    });
    expect(Object.isFrozen(job)).toBe(true);
  });

  it('dla braku wiersza (demo, nieaktywna, wygasła, niezweryfikowana, nieistniejąca) daje jednakowy błąd', async () => {
    // Filtry egzekwuje baza (0105, dowód rls.sql CJ186); tu: brak wiersza i wiersz innej oferty.
    const messages = new Set<string>();
    for (const row of [null, { ...ROW, slug: 'inna-oferta' }]) {
      const error = await load(row).job.catch((e: Error) => e);
      expect(error).toBeInstanceOf(JobUnavailableError);
      messages.add((error as Error).message);
    }
    expect(messages.size).toBe(1);
    // Kontrola ujemna: wiersz tej oferty przechodzi.
    await expect(load(ROW).job).resolves.toMatchObject({ slug: ROW.slug });
  });

  it('pomija pola spoza grafiki, nawet gdy źródło by je zwróciło (bez PII)', async () => {
    const job = await load({ ...ROW, email: 'hr@firma.be', phone: '+32 470 00 00 00', is_demo: false, status: 'active' }).job;
    const serialized = JSON.stringify(job);
    expect(serialized).not.toMatch(/hr@firma\.be|\+32|is_demo|isDemo|status/);
  });

  it('zapytanie czyta dokładnie kolumny get_campaign_job z migracji 0105', () => {
    const migration = readFileSync(resolve('supabase/migrations/0105_campaign_job_source.sql'), 'utf8');
    const header = /function public\.get_campaign_job\([^)]*\)\s*returns table \(([^)]*)\)/.exec(migration)?.[1] ?? '';
    const columns = header.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
    expect(columns).toEqual([
      'slug', 'title', 'company_name', 'city', 'region', 'contract_type', 'accommodation',
      'salary_min', 'salary_max', 'currency', 'salary_period',
    ]);
    const source = readFileSync(resolve('scripts/lib/job-post-source.mjs'), 'utf8');
    const select = /SELECT ([\s\S]*?)\s+FROM public\.get_campaign_job/.exec(source)?.[1] ?? '';
    expect(select.split(',').map((c) => c.trim())).toEqual(columns);
  });

  it('odrzuca nieprawidłowy slug i język przed zapytaniem do bazy', async () => {
    for (const [slug, locale] of [
      ['oferta.json', 'pl'],
      ['../oferta', 'pl'],
      ['Oferta', 'pl'],
      [ROW.slug as string, 'de'],
    ] as const) {
      const { query, job } = load(ROW, locale, slug);
      await expect(job).rejects.toThrow(/slug:|locale:/);
      expect(query).not.toHaveBeenCalled();
    }
  });

  it('czyta w transakcji gościa (SET LOCAL ROLE anon) i odrzuca login uprzywilejowany', async () => {
    const statements: string[] = [];
    const client = {
      query: vi.fn(async (sql: string) => {
        statements.push(sql);
        return { rows: sql.includes('get_campaign_job') ? [ROW] : [] };
      }),
    };
    await expect(createAnonJobQuery(client)(ROW.slug, 'pl')).resolves.toEqual([ROW]);
    expect(statements[0]).toBe('BEGIN');
    expect(statements[1]).toBe('SET LOCAL ROLE anon');
    expect(statements[3]).toMatch(/FROM public\.get_campaign_job\(/);
    expect(statements.at(-1)).toBe('COMMIT');
    expect(statements.join('\n')).not.toMatch(/is_demo|from public\.jobs/i);

    const role = (rolsuper: boolean, rolbypassrls: boolean) => ({
      query: async () => ({ rows: [{ rolsuper, rolbypassrls }] }),
    });
    await expect(assertRestrictedLogin(role(true, false))).rejects.toThrow(/ograniczonego loginu/);
    await expect(assertRestrictedLogin(role(false, true))).rejects.toThrow(/ograniczonego loginu/);
    await expect(assertRestrictedLogin(role(false, false))).resolves.toBeUndefined();
  });

  it('odrzuca podmieniony obiekt oferty (status/isDemo z lokalnego pliku)', async () => {
    const job = await load(ROW).job;
    const forged = { ...job, isDemo: false, status: 'active' };
    expect(() => buildPostContent(forged)).toThrow(/get_campaign_job/);
    expect(() => buildPostContent(JSON.parse(JSON.stringify(job)))).toThrow(/get_campaign_job/);
    // Kontrola ujemna: oryginalny obiekt ze źródła przechodzi.
    expect(buildPostContent(job).title).toBe('Operator wózka widłowego');
  });

  it('CLI nie przyjmuje pliku z danymi oferty i nic nie zapisuje', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pracujbe-post-cli-'));
    const input = join(directory, 'oferta.json');
    await writeFile(input, JSON.stringify({ ...ROW, isDemo: false, status: 'active' }));
    try {
      await expect(
        execFileAsync(process.execPath, [SCRIPT, input, 'pl', join(directory, 'post')], {
          env: { ...process.env, DATABASE_APP_URL: '' },
        }),
      ).rejects.toMatchObject({ stderr: expect.stringMatching(/slug:/) });
      await expect(readFile(join(directory, 'post.svg'))).rejects.toThrow();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});

describe('treść i SVG posta 1080 × 1080 (#181)', () => {
  it.each(LOCALES)('%s: stawka w polu wynagrodzenia z etykietami w języku posta', async (locale) => {
    const messages = (await import(`../../src/messages/${locale}.json`)).default;
    const svg = await svgFor(ROW, locale);
    expect(svg).toContain('viewBox="0 0 1080 1080"');
    expect(svg).toContain(`lang="${locale}"`);
    expect(svg).toContain(escapeXml(messages.jobs.passport.salary.toLocaleUpperCase(locale)));
    expect(svg).toContain(escapeXml(messages.jobs.passport.salaryPeriods.hour));
    expect(svg).toContain(escapeXml(messages.contractTypes.permanent));
    expect(svg).toContain(escapeXml(`${messages.jobs.passport.viewOffer} →`));
    expect(svg).toContain('#D92932');
    expect(svg).toMatch(/17.*20/);
    expect(svg).toContain(`https://pracuj.be/${locale}/oferty-pracy/operator-wozka-widlowego-antwerpia`);
  });

  it.each(LOCALES)('%s: bez stawki nie ma pola wynagrodzenia ani tekstu zastępczego', async (locale) => {
    const messages = (await import(`../../src/messages/${locale}.json`)).default;
    const svg = await svgFor({ ...ROW, salary_min: null, salary_max: null, salary_period: 'hour' }, locale);
    expect(svg).not.toContain(escapeXml(messages.jobs.passport.salary.toLocaleUpperCase(locale)));
    expect(svg).not.toContain(escapeXml(messages.jobs.passport.salaryPeriods.hour));
    expect(svg).not.toMatch(/€|EUR|<line/);
    expect(svg).toContain('font-size="61" font-weight="700" fill="#151515">Antwerpia<');
  });

  it('nie zawiera oznaczeń materiału demonstracyjnego ze wzoru', async () => {
    expect(await svgFor(ROW)).not.toMatch(/demonstracyjn|przykładow/i);
  });

  it('ucieka znaki SVG z danych oferty, nie pozwalając wstrzyknąć znacznika', async () => {
    const svg = await svgFor({
      ...ROW,
      title: 'Kierowca <script>alert(1)</script> & "C"',
      company_name: "O'Brien & <Syn>",
    });
    expect(svg).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(svg).toContain('&amp;');
    expect(svg).toContain('O&apos;Brien &amp; &lt;Syn&gt;');
    expect(svg).not.toContain('<script>');
    expect(svg).not.toContain('<Syn>');
    // Kontrola ujemna: bez escapowania znacznik trafiłby do SVG.
    expect('<script>').not.toBe(escapeXml('<script>'));
  });

  it('odrzuca brak tytułu/firmy/miasta i znaki sterujące', async () => {
    for (const [field, pattern] of [
      ['title', /title:/],
      ['company_name', /company:/],
      ['city', /city:/],
    ] as const) {
      const job = await load({ ...ROW, [field]: '  ' }).job;
      expect(() => buildPostContent(job)).toThrow(pattern);
    }
    const control = await load({ ...ROW, title: 'Kierowca\u0007' }).job;
    expect(() => buildPostContent(control)).toThrow(/sterujące/);
  });

  it('dłuższy tytuł przechodzi na mniejszy krój, zbyt długi kończy się błędem', async () => {
    const mid = await load({ ...ROW, title: 'Operator wózka widłowego z uprawnieniami UDT na zmiany nocne' }).job;
    const midContent = buildPostContent(mid);
    expect((await layoutPost(midContent, fakeMeasure)).title.size).toBe(60);
    const long = await load({ ...ROW, title: 'Operator wózka widłowego '.repeat(8) }).job;
    await expect(layoutPost(buildPostContent(long), fakeMeasure)).rejects.toThrow(/title:.*nie mieści/);
  });

  it('długa nazwa firmy jest skracana z wielokropkiem', async () => {
    const job = await load({ ...ROW, company_name: 'Bardzo Długa Nazwa Firmy Logistycznej '.repeat(4) }).job;
    const layout = await layoutPost(buildPostContent(job), fakeMeasure);
    expect(layout.company.endsWith('…')).toBe(true);
    expect(await fakeMeasure(layout.company, '700 23px Arial')).toBeLessThanOrEqual(950);
  });
});

describe('eksport SVG i PNG w Chromium', () => {
  let browser: Awaited<ReturnType<typeof launchChromium>>;
  let directory: string;

  beforeAll(async () => {
    browser = await launchChromium();
    directory = await mkdtemp(join(tmpdir(), 'pracujbe-post-'));
  }, 60_000);

  afterAll(async () => {
    await browser?.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  });

  it.each([
    ['ze stawką', ROW],
    ['bez stawki', { ...ROW, salary_min: null, salary_max: null }],
  ])('%s: PNG i SVG mają 1080 × 1080', async (name, row) => {
    const job = await load(row).job;
    const prefix = join(directory, name.replace(/\s/g, '-'));
    await exportJobPost({ job, outputPrefix: prefix, browser });
    const svg = await readFile(`${prefix}.svg`, 'utf8');
    const png = decodePng(await readFile(`${prefix}.png`));
    expect(svg).toContain('width="1080" height="1080"');
    expect(png.width).toBe(1080);
    expect(png.height).toBe(1080);
  }, 60_000);

  it('zbyt długi tytuł (pomiar w Chromium) nie zapisuje plików', async () => {
    const job = await load({ ...ROW, title: 'Magazynier '.repeat(30) }).job;
    const prefix = join(directory, 'za-dlugi');
    await expect(exportJobPost({ job, outputPrefix: prefix, browser })).rejects.toThrow(/title:/);
    await expect(readFile(`${prefix}.svg`)).rejects.toThrow();
    await expect(readFile(`${prefix}.png`)).rejects.toThrow();
  }, 60_000);
});
