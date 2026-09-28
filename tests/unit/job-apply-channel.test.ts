import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  hasApplyChannel,
  isApplyEmail,
  isApplyPhone,
  isApplyUrl,
  normalizeApplyPhone,
} from '@/lib/job-apply-channel';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import { parseJobApplyChannel } from '@/lib/jobs';
import {
  step9DraftSchema,
  step9PublishedSchema,
  step9Schema,
} from '@/lib/validation/job';

/**
 * #1129: lustro TS reguł kanału aplikowania = CHECK-i i funkcje bazy (migracja z
 * `job_apply_url_ok`; numer tymczasowy 0950 — test szuka pliku po treści, więc przeżyje
 * nadanie ostatecznego numeru). Te same przypadki graniczne co sekcja AC950 w rls.sql.
 */
const MIGRATIONS_DIR = join(process.cwd(), 'supabase/migrations');
const MIGRATION_FILE = readdirSync(MIGRATIONS_DIR)
  .filter((f) => f.endsWith('.sql'))
  .find((f) => readFileSync(join(MIGRATIONS_DIR, f), 'utf8').includes('function public.job_apply_url_ok'));
const MIGRATION = MIGRATION_FILE ? readFileSync(join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8') : '';

/** Wzorzec `~ '…'` z ciała funkcji SQL → RegExp JS (apostrofy SQL `''` → `'`). */
function sqlPattern(fn: string): RegExp {
  const start = MIGRATION.indexOf(`function public.${fn}(`);
  const body = MIGRATION.slice(start, MIGRATION.indexOf('$$;', start));
  const match = body.match(/~ '((?:[^']|'')*)'/);
  if (!match) throw new Error(`brak wzorca w ${fn}`);
  return new RegExp(match[1]!.replace(/''/g, "'"));
}

/** Lustro całych funkcji SQL (wzorzec + limity długości z migracji). */
const sql = {
  url: (v: string) => v === v.trim() && v.length >= 12 && v.length <= 2048 && sqlPattern('job_apply_url_ok').test(v),
  email: (v: string) =>
    v.length <= 254 && (v.split('@')[0] ?? '').length <= 64 && sqlPattern('job_apply_email_ok').test(v),
  phone: (v: string) => sqlPattern('job_apply_phone_ok').test(v),
};

const URL_CASES: [string, boolean][] = [
  ['https://firma.be/praca', true],
  ['https://firma.be/praca?ref=pracuj#form', true],
  ['https://jobs.firma.be:8443/a', true],
  ['https://firma.be:65535', true],
  ['http://firma.be/praca', false],
  ['javascript:alert(1)', false],
  ['/praca/aplikuj', false],
  ['https://localhost/praca', false],
  ['https://firma.be:0/praca', false],
  ['https://firma.be:65536/praca', false],
  ['https://firma.be/a b', false],
  ['https://firma.be/"x"', false],
  ['https://firma.be/<x>', false],
  [`https://firma.be/${'a'.repeat(2048 - 'https://firma.be/'.length)}`, true],
  [`https://firma.be/${'a'.repeat(2049 - 'https://firma.be/'.length)}`, false],
];

const EMAIL_CASES: [string, boolean][] = [
  ['praca@firma.be', true],
  ['praca.hr+be@firma-a.be', true],
  ['a_b-c@sub.firma.co.uk', true],
  ['praca(at)firma.be', false],
  ['praca@firma', false],
  ['praca@firma.be?subject=x', false],
  ['mailto:praca@firma.be', false],
  ['praca@firma.be&cc=x@y.be', false],
  ['pra ca@firma.be', false],
  ['praca..hr@firma.be', false],
  ['.praca@firma.be', false],
  ['praca%40@firma.be', false],
  [`${'a'.repeat(64)}@firma.be`, true],
  [`${'a'.repeat(65)}@firma.be`, false],
  [`a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(57)}.be`, true],
  [`a@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.${'e'.repeat(58)}.be`, false],
];

const PHONE_CASES: [string, boolean][] = [
  ['+32470123456', true],
  ['+3220000000', true],
  ['+123456789012345', true],
  ['+1234567', false],
  ['+1234567890123456', false],
  ['+0470123456', false],
  ['0470123456', false],
  ['+32 470', false],
];

describe('kanał aplikowania: lustro reguł bazy (0950)', () => {
  it('migracja z funkcjami reguł istnieje', () => {
    expect(MIGRATION_FILE).toBeDefined();
    expect(MIGRATION).toContain('constraint jobs_apply_url_format');
    expect(MIGRATION).toContain('constraint jobs_apply_email_format');
    expect(MIGRATION).toContain('constraint jobs_apply_phone_format');
  });

  it.each(URL_CASES)('URL #%# → %s (TS = baza)', (value, expected) => {
    expect(sql.url(value)).toBe(expected);
    expect(isApplyUrl(value)).toBe(expected);
  });

  it.each(EMAIL_CASES)('e-mail #%# → %s (TS = baza)', (value, expected) => {
    expect(sql.email(value)).toBe(expected);
    expect(isApplyEmail(value)).toBe(expected);
  });

  it.each(PHONE_CASES)('telefon #%# → %s (TS = baza)', (value, expected) => {
    expect(sql.phone(value)).toBe(expected);
    expect(isApplyPhone(value)).toBe(expected);
  });

  it('kontrola ujemna: porównanie łapie rozjazd reguły (bez sprawdzenia portu)', () => {
    const loose = /^https:\/\/[A-Za-z0-9.-]+\.[A-Za-z]+(:[0-9]{1,5})?(\/.*)?$/;
    const diverging = URL_CASES.filter(([v]) => loose.test(v) !== sql.url(v));
    expect(diverging.length).toBeGreaterThan(0);
  });

  it('telefon: normalizacja spacji, kropek, myślników, nawiasów i prefiksu 00', () => {
    expect(normalizeApplyPhone(' +32 (0)470 12.34-56 ')).toBe('+320470123456');
    expect(normalizeApplyPhone('0032 470 12 34 56')).toBe('+32470123456');
    expect(normalizeApplyPhone('0470 12 34 56')).toBe('0470123456');
    expect(isApplyPhone('0032 470 12 34 56')).toBe(true);
    expect(isApplyPhone('0470 12 34 56')).toBe(false);
  });

  it('co najmniej jeden kanał (lustro job_has_apply_channel)', () => {
    expect(hasApplyChannel({})).toBe(false);
    expect(hasApplyChannel({ applyUrl: '  ', applyEmail: '', applyPhone: null })).toBe(false);
    expect(hasApplyChannel({ applyPhone: '+32470123456' })).toBe(true);
  });

  it('publikacja i rewizja zgłaszają JOB_APPLY_CHANNEL_REQUIRED; akcje mapują kod', () => {
    const publish = MIGRATION.slice(MIGRATION.indexOf('function public.publish_job('));
    expect(publish.slice(0, publish.indexOf('$$;'))).toContain("'JOB_APPLY_CHANNEL_REQUIRED:");
    const revision = MIGRATION.slice(MIGRATION.indexOf('function public.update_published_job('));
    expect(revision.slice(0, revision.indexOf('$$;'))).toContain("'JOB_APPLY_CHANNEL_REQUIRED:");
    const actions = readFileSync(join(process.cwd(), 'src/lib/actions/jobs.ts'), 'utf8');
    expect(actions).toContain("m.includes('JOB_APPLY_CHANNEL_REQUIRED')) return 'JOB_APPLY_CHANNEL_REQUIRED'");
  });

  it('import AI nie wypełnia kanału (rekruter wpisuje go ręcznie, jak contactEmail #500)', () => {
    const schema = readFileSync(join(process.cwd(), 'src/lib/ai-import/schema.ts'), 'utf8');
    expect(schema).not.toMatch(/apply(Url|Email|Phone)|apply_(url|email|phone)/);
  });
});

describe('kanał aplikowania: kroki kreatora (Zod)', () => {
  const base = { companyDescription: 'Rodzinna firma logistyczna z Antwerpii.' };

  it('szkic bez kanału przechodzi; zły format odrzucany już w szkicu', () => {
    expect(step9DraftSchema.safeParse(base).success).toBe(true);
    const bad = step9DraftSchema.safeParse({ ...base, applyUrl: 'http://firma.be' });
    expect(bad.success).toBe(false);
    expect(bad.error?.issues[0]).toMatchObject({ path: ['applyUrl'], message: 'job.error.applyUrlInvalid' });
    expect(step9DraftSchema.safeParse({ ...base, applyEmail: 'a@b.be?cc=x' }).success).toBe(false);
    expect(step9DraftSchema.safeParse({ ...base, applyPhone: '12' }).success).toBe(false);
  });

  it('publikacja bez kanału → błąd przy polu strony; z telefonem → znormalizowany zapis', () => {
    const missing = step9Schema.safeParse({ ...base, agreePublish: true });
    expect(missing.success).toBe(false);
    expect(missing.error?.issues[0]).toMatchObject({
      path: ['applyUrl'],
      message: 'job.error.applyChannelRequired',
    });
    const ok = step9Schema.safeParse({ ...base, agreePublish: true, applyPhone: '0032 470 12 34 56' });
    expect(ok.success && ok.data.applyPhone).toBe('+32470123456');
  });

  it('edycja opublikowanej oferty wymaga kanału bez zgody na publikację', () => {
    expect(step9PublishedSchema.safeParse(base).success).toBe(false);
    expect(step9PublishedSchema.safeParse({ ...base, applyEmail: 'praca@firma.be' }).success).toBe(true);
  });

  it('krok 9 szkicu zapisuje trzy kolumny; pusta wartość czyści pole', () => {
    const parsed = step9DraftSchema.parse({ ...base, applyUrl: ' https://firma.be/praca ', applyPhone: '+32 470 12 34 56' });
    expect(buildDraftStepContent(9, parsed)).toMatchObject({
      job: { apply_url: 'https://firma.be/praca', apply_email: null, apply_phone: '+32470123456' },
    });
  });
});

describe('kanał aplikowania: odczyt oferty publicznej', () => {
  it('get_public_job → applyChannel; wartości spoza reguł pominięte (drugie sprawdzenie)', () => {
    expect(parseJobApplyChannel({ apply_url: 'https://firma.be/praca', apply_email: null, apply_phone: '+32470123456' }))
      .toEqual({ url: 'https://firma.be/praca', phone: '+32470123456' });
    expect(parseJobApplyChannel({ apply_url: 'javascript:alert(1)', apply_email: 'x?cc=y', apply_phone: 'abc' }))
      .toBeUndefined();
    expect(parseJobApplyChannel({})).toBeUndefined();
  });
});
