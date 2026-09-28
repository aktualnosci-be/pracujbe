import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildJobBenefitsText,
  buildJobCostItems,
  formatEuro,
  hasJobCostDetails,
  jobCostsPatch,
  parseJobCostsRow,
  type JobCostLabels,
} from '@/lib/job-costs';
import { JOINT_COMMITTEES, findJointCommittee, minimumWagesUrl } from '@/lib/joint-committees';
import { buildDraftStepContent } from '@/lib/job-draft-content';
import { step8PublishSchema, step8Schema, type JobStep8 } from '@/lib/validation/job';
import { buildJobPostingJsonLd } from '@/lib/seo/structured-data';
import type { JobDetail } from '@/lib/jobs';

const MIGRATION = readFileSync(
  join(process.cwd(), 'supabase/migrations/0169_job_costs_benefits.sql'),
  'utf8',
);

/** Wiersze `insert into public.joint_committees … values` z migracji → kod + nazwy. */
function migrationCommittees(sql: string): { code: string; names: string[] }[] {
  const start = sql.indexOf('insert into public.joint_committees');
  const end = sql.indexOf(';', start);
  const block = sql.slice(start, end);
  return [...block.matchAll(/\(\s*'([^']*)',\s*((?:'(?:[^']|'')*'\s*,?\s*){4})\)/g)].map((m) => ({
    code: m[1]!,
    names: [...m[2]!.matchAll(/'((?:[^']|'')*)'/g)].map((n) => n[1]!.replace(/''/g, "'")),
  }));
}

function tsCommittees(list = JOINT_COMMITTEES): { code: string; names: string[] }[] {
  return list.map((c) => ({ code: c.code, names: [c.names.pl, c.names.nl, c.names.fr, c.names.en] }));
}

const LABELS: JobCostLabels = {
  accommodation: 'Zakwaterowanie',
  transport: 'Transport',
  mealVouchers: 'Bony żywieniowe',
  jointCommittee: 'Komisja parytetowa',
  yes: 'Tak',
  no: 'Nie',
  kind: (k) => `kind:${k}`,
  cost: (amount, period) => `${amount}/${period}`,
  free: 'Bez kosztów',
  deducted: (y) => (y ? 'potrącane' : 'niepotrącane'),
  registration: (y) => (y ? 'meldunek' : 'bez meldunku'),
  afterContract: (v) => `after:${v}`,
  shuttle: 'Dowóz',
  reimbursed: 'Zwrot',
  mealPerDay: (a) => `${a} dziennie`,
  committeeCode: (c) => `PC ${c}`,
  money: (n) => `${n} EUR`,
};

function step8(overrides: Partial<JobStep8> = {}): JobStep8 {
  return step8Schema.parse({ conditions: [], benefits: [], ...overrides });
}

describe('słownik komisji parytetowych (0169)', () => {
  it('lustro TS jest identyczne z danymi migracji (kod i nazwy w 4 językach)', () => {
    const fromSql = migrationCommittees(MIGRATION);
    expect(fromSql.length).toBe(JOINT_COMMITTEES.length);
    expect(fromSql).toEqual(tsCommittees());
  });

  it('kontrola ujemna: zmieniona nazwa albo brakujący kod jest wykrywany', () => {
    const changed = JOINT_COMMITTEES.map((c) =>
      c.code === '124' ? { ...c, names: { ...c.names, nl: 'Bouw' } } : c,
    );
    expect(migrationCommittees(MIGRATION)).not.toEqual(tsCommittees(changed));
    expect(migrationCommittees(MIGRATION)).not.toEqual(tsCommittees(JOINT_COMMITTEES.slice(1)));
  });

  it('kody są unikalne i w formacie CHECK z migracji', () => {
    const codes = JOINT_COMMITTEES.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
    for (const code of codes) expect(code).toMatch(/^[0-9]{3}(\.[0-9]{2})?$/);
  });

  it('link do oficjalnej bazy stawek: FR = salairesminimums.be, pozostałe = minimumlonen.be', () => {
    expect(minimumWagesUrl('fr')).toBe('https://www.salairesminimums.be/jc_overview.html');
    for (const l of ['pl', 'nl', 'en'] as const) {
      expect(minimumWagesUrl(l)).toBe('https://www.minimumlonen.be/jc_overview.html');
    }
  });
});

describe('krok 8 — walidacja kosztów', () => {
  it('przyjmuje komplet pól przy zakwaterowaniu zapewnionym', () => {
    const r = step8Schema.safeParse({
      accommodationKind: 'provided', accommodationCost: 125.5, accommodationCostPeriod: 'week',
      accommodationDeducted: true, accommodationRegistration: false,
      accommodationAfterContract: 'can_stay', transportShuttle: true, transportReimbursed: false,
      mealVoucherDaily: 8, jointCommittee: '124',
    });
    expect(r.success).toBe(true);
  });

  it('szczegóły mieszkania bez „zapewnione” = błąd przy rodzaju', () => {
    const r = step8Schema.safeParse({ accommodationKind: 'assistance', accommodationCost: 100, accommodationCostPeriod: 'month' });
    expect(r.success).toBe(false);
    expect(r.error?.issues.map((i) => i.message)).toContain('job.error.accommodationDetailsProvidedOnly');
  });

  it('koszt bez okresu i okres bez kosztu = błąd przy polu', () => {
    const a = step8Schema.safeParse({ accommodationKind: 'provided', accommodationCost: 100 });
    expect(a.error?.issues[0]?.path).toEqual(['accommodationCostPeriod']);
    const b = step8Schema.safeParse({ accommodationKind: 'provided', accommodationCostPeriod: 'week' });
    expect(b.error?.issues[0]?.path).toEqual(['accommodationCost']);
  });

  it('kwoty: najwyżej 2 miejsca po przecinku, limity jak CHECK w bazie; kod spoza słownika odrzucony', () => {
    const bad = [
      { accommodationKind: 'provided', accommodationCost: 10.555, accommodationCostPeriod: 'week' },
      { accommodationKind: 'provided', accommodationCost: 5000.01, accommodationCostPeriod: 'week' },
      { accommodationKind: 'provided', accommodationCost: Number.NaN, accommodationCostPeriod: 'week' },
      { mealVoucherDaily: 0 },
      { mealVoucherDaily: 20.01 },
      { jointCommittee: '999' },
    ];
    for (const input of bad) expect(step8Schema.safeParse(input).success, JSON.stringify(input)).toBe(false);
    expect(step8Schema.safeParse({ accommodationKind: 'provided', accommodationCost: 0, accommodationCostPeriod: 'month' }).success).toBe(true);
  });
});

describe('krok 8 — zakwaterowanie zapewnione w ofercie publicznej (decyzja 28.09.2026)', () => {
  const provided = { accommodationKind: 'provided' as const };

  it('szkic przyjmuje „zapewnione” bez kosztu i potrącenia (szkic może być niekompletny)', () => {
    expect(step8Schema.safeParse(provided).success).toBe(true);
  });

  it('publikacja/edycja: brak kosztu i brak potrącenia = błąd przy każdym z pól', () => {
    const r = step8PublishSchema.safeParse(provided);
    expect(r.success).toBe(false);
    const byPath = Object.fromEntries((r.error?.issues ?? []).map((i) => [i.path.join('.'), i.message]));
    expect(byPath).toEqual({
      accommodationCost: 'job.error.accommodationCostMandatory',
      accommodationDeducted: 'job.error.accommodationDeductedRequired',
    });
  });

  it('koszt 0 (bez kosztów) + „nie potrącany” wystarcza; inne rodzaje nie wymagają kosztu', () => {
    expect(
      step8PublishSchema.safeParse({
        ...provided, accommodationCost: 0, accommodationCostPeriod: 'week', accommodationDeducted: false,
      }).success,
    ).toBe(true);
    expect(step8PublishSchema.safeParse({ ...provided, accommodationCost: 0, accommodationCostPeriod: 'week' }).success).toBe(false);
    expect(step8PublishSchema.safeParse({ ...provided, accommodationDeducted: true }).success).toBe(false);
    expect(step8PublishSchema.safeParse({ accommodationKind: 'assistance' }).success).toBe(true);
    expect(step8PublishSchema.safeParse({ accommodationKind: 'none' }).success).toBe(true);
    expect(step8PublishSchema.safeParse({}).success).toBe(true);
  });

  it('komunikaty błędów są w 4 językach (NL w formie je/jouw, bez „u”)', () => {
    for (const locale of ['pl', 'nl', 'fr', 'en']) {
      const messages = JSON.parse(readFileSync(join(process.cwd(), `src/messages/${locale}.json`), 'utf8'));
      for (const key of ['accommodationCostMandatory', 'accommodationDeductedRequired']) {
        expect(typeof messages.job.error[key], `${locale}.job.error.${key}`).toBe('string');
      }
      expect(typeof messages.errors.jobAccommodationTermsRequired, `${locale}.errors`).toBe('string');
      if (locale === 'nl') {
        const texts = [
          messages.job.error.accommodationCostMandatory,
          messages.job.error.accommodationDeductedRequired,
          messages.errors.jobAccommodationTermsRequired,
        ].join(' ');
        expect(texts).not.toMatch(/\b(u|uw)\b/i);
      }
    }
  });

  it('baza: strażnik publikacji w migracji i mapowanie kodu w akcjach', () => {
    expect(MIGRATION).toMatch(/create trigger trg_jobs_accommodation_terms\s+before insert or update on public\.jobs/);
    expect(MIGRATION).toContain("'JOB_ACCOMMODATION_TERMS_REQUIRED:");
    const actions = readFileSync(join(process.cwd(), 'src/lib/actions/jobs.ts'), 'utf8');
    expect(actions).toContain("m.includes('JOB_ACCOMMODATION_TERMS_REQUIRED')) return 'JOB_ACCOMMODATION_TERMS_REQUIRED'");
  });
});

describe('jobCostsPatch — zapis zgodny z CHECK-ami bazy', () => {
  it('zapewnione: flaga zakwaterowania + szczegóły; transport z dowozu', () => {
    const patch = jobCostsPatch(step8({
      accommodationKind: 'provided', accommodationCost: 120, accommodationCostPeriod: 'week',
      accommodationDeducted: true, transportShuttle: true, transportReimbursed: false,
      mealVoucherDaily: 8, jointCommittee: '124',
    }));
    expect(patch).toEqual({
      accommodation: true, transport: true, accommodation_kind: 'provided', accommodation_cost: 120,
      accommodation_cost_period: 'week', accommodation_deducted: true, accommodation_registration: null,
      accommodation_after_contract: null, transport_shuttle: true, transport_reimbursed: false,
      meal_voucher_daily: 8, joint_committee: '124',
    });
  });

  it('„brak” zdejmuje flagę; „pomoc” ustawia flagę bez szczegółów', () => {
    expect(jobCostsPatch(step8({ accommodation: true, accommodationKind: 'none' }))).toMatchObject({
      accommodation: false, accommodation_kind: 'none', accommodation_cost: null,
    });
    expect(jobCostsPatch(step8({ accommodationKind: 'assistance' }))).toMatchObject({
      accommodation: true, accommodation_kind: 'assistance', accommodation_deducted: null,
    });
  });

  it('import bez szczegółów (same flagi) zachowuje flagi i niczego nie dopowiada', () => {
    expect(jobCostsPatch(step8({ accommodation: true, transport: true }))).toMatchObject({
      accommodation: true, transport: true, accommodation_kind: null, transport_shuttle: false,
    });
  });

  it('szczegóły dojazdu wyznaczają flagę transportu (także jej zdjęcie)', () => {
    expect(jobCostsPatch(step8({ transport: true, transportShuttle: false, transportReimbursed: false })).transport).toBe(false);
    expect(jobCostsPatch(step8({ transportReimbursed: true })).transport).toBe(true);
  });

  it('krok 8 kreatora wysyła patch kosztów w `job`', () => {
    const content = buildDraftStepContent(8, step8({ accommodationKind: 'assistance', mealVoucherDaily: 6.5 }))!;
    expect(content.job).toMatchObject({ accommodation: true, accommodation_kind: 'assistance', meal_voucher_daily: 6.5 });
  });
});

describe('parseJobCostsRow', () => {
  it('numeric jako tekst → liczba; szczegóły mieszkania tylko przy „zapewnione”; nieznany kod pominięty', () => {
    expect(parseJobCostsRow({
      accommodation_kind: 'provided', accommodation_cost: '125.50', accommodation_cost_period: 'week',
      accommodation_deducted: false, accommodation_registration: null, accommodation_after_contract: 'can_stay',
      transport_shuttle: false, transport_reimbursed: true, meal_voucher_daily: '8.00', joint_committee: '124',
    })).toEqual({
      accommodationKind: 'provided', accommodationCost: 125.5, accommodationCostPeriod: 'week',
      accommodationDeducted: false, accommodationAfterContract: 'can_stay', transportShuttle: false,
      transportReimbursed: true, mealVoucherDaily: 8, jointCommittee: '124',
    });
    expect(parseJobCostsRow({
      accommodation_kind: 'assistance', accommodation_cost: '100', accommodation_cost_period: 'week',
      joint_committee: '999', transport_shuttle: false, transport_reimbursed: false,
    })).toEqual({ accommodationKind: 'assistance', transportShuttle: false, transportReimbursed: false });
    expect(parseJobCostsRow(null)).toBeUndefined();
  });
});

describe('sekcja „Koszty i dodatki” i jobBenefits', () => {
  const base = { accommodation: false, transport: false };

  it('stara oferta bez szczegółów: tak/nie z flag, bez bonów i komisji', () => {
    const items = buildJobCostItems({ accommodation: true, transport: false }, LABELS, 'pl');
    expect(items.map((i) => [i.key, i.value])).toEqual([['accommodation', 'Tak'], ['transport', 'Nie']]);
    expect(hasJobCostDetails(undefined)).toBe(false);
    expect(buildJobBenefitsText({ accommodation: true, transport: false }, LABELS, 'pl')).toBe('Zakwaterowanie');
  });

  it('pełne dane: koszt, potrącenie, meldunek, po umowie, dowóz+zwrot, bony, komisja z nazwą w języku strony', () => {
    const job = {
      ...base, accommodation: true, transport: true,
      costs: {
        accommodationKind: 'provided' as const, accommodationCost: 120, accommodationCostPeriod: 'week' as const,
        accommodationDeducted: true, accommodationRegistration: false,
        accommodationAfterContract: 'transition_period' as const, transportShuttle: true,
        transportReimbursed: true, mealVoucherDaily: 8, jointCommittee: '124',
      },
    };
    const items = buildJobCostItems(job, LABELS, 'nl');
    expect(items).toEqual([
      { key: 'accommodation', label: 'Zakwaterowanie', value: 'kind:provided',
        details: ['120 EUR/week', 'potrącane', 'bez meldunku', 'after:transition_period'] },
      { key: 'transport', label: 'Transport', value: 'Dowóz, Zwrot', details: [] },
      { key: 'mealVouchers', label: 'Bony żywieniowe', value: '8 EUR dziennie', details: [] },
      { key: 'jointCommittee', label: 'Komisja parytetowa', value: 'PC 124 — Bouwbedrijf', details: [], committeeCode: '124' },
    ]);
    expect(hasJobCostDetails(job.costs)).toBe(true);
    const benefits = buildJobBenefitsText(job, LABELS, 'nl')!;
    expect(benefits).toContain('Zakwaterowanie: kind:provided (120 EUR/week; potrącane');
    expect(benefits).toContain('Bony żywieniowe: 8 EUR dziennie');
    // Komisja parytetowa nie ma odpowiednika w schema.org — nie trafia do jobBenefits.
    expect(benefits).not.toContain('PC 124');
  });

  it('koszt 0 = „bez kosztów”; „brak” zakwaterowania i brak dojazdu nie są świadczeniem', () => {
    const free = buildJobCostItems({ ...base, accommodation: true, costs: { accommodationKind: 'provided', accommodationCost: 0, accommodationCostPeriod: 'month', transportShuttle: false, transportReimbursed: false } }, LABELS, 'pl');
    expect(free[0]!.details).toEqual(['Bez kosztów']);
    expect(buildJobBenefitsText({ ...base, costs: { accommodationKind: 'none', transportShuttle: false, transportReimbursed: false } }, LABELS, 'pl')).toBeUndefined();
  });

  it('JobPosting: jobBenefits tylko gdy podane', () => {
    const job = {
      id: 'j1', slug: 's', title: 'T', companyName: 'C', companyVerified: true, city: 'Gent', region: 'Flandria',
      contractType: 'temporary', currency: 'EUR', publishedAt: '2026-09-01T00:00:00Z', isNew: false,
      highlights: [], category: 'warehouse', accommodation: true, immediate: false, noLanguageRequired: false,
      description: 'Opis', responsibilities: [], requirementsMandatory: [], requirementsOptional: [], conditions: [],
      workingHours: '', languages: [], transport: false, companyDescription: '',
    } as unknown as JobDetail;
    const labels = { responsibilities: 'R', requirementsMandatory: 'M', requirementsOptional: 'O', conditions: 'C', workingHours: 'W', shifts: 'S' };
    expect(buildJobPostingJsonLd(job, 'https://x', labels)).not.toHaveProperty('jobBenefits');
    expect(buildJobPostingJsonLd(job, 'https://x', labels, { jobBenefits: 'Zakwaterowanie' })).toMatchObject({ jobBenefits: 'Zakwaterowanie' });
  });

  it('formatEuro: grosze tylko gdy są', () => {
    expect(formatEuro(120, 'en')).toBe('€120');
    expect(formatEuro(8.5, 'en')).toBe('€8.50');
    expect(findJointCommittee('322')?.names.fr).toContain('intérimaire');
  });
});
