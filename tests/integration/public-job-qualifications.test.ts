import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPublicJobQualifications } from '../../src/lib/db/public-jobs';
import { parseJobQualifications } from '../../src/lib/job-qualifications';
import { startPortalDb, type PortalDb } from './support/portal-db';

/**
 * #866 (decyzja 01.10.2026): umiejętności i certyfikaty na publicznym szczególe oferty czytane
 * BEZ migracji — relacje `job_skills`/`job_certificates` pod rolą anon. Dowód na pełnych
 * migracjach: oferta publiczna je oddaje, nazwa umiejętności ze słownika tylko w języku strony,
 * a oferta niepubliczna (szkic, firma niezweryfikowana) nie oddaje niczego (RLS `*_select`).
 */
let db: PortalDb;
const verifiedCompany = randomUUID();
const unverifiedCompany = randomUUID();
const publicJob = randomUUID();
const draftJob = randomUUID();
const unverifiedJob = randomUUID();
const skillId = randomUUID();

beforeAll(async () => {
  db = await startPortalDb();
  await db.admin.query(
    `INSERT INTO public.companies(id, name, status) VALUES ($1, 'Firma Q', 'verified'), ($2, 'Firma U', 'unverified')`,
    [verifiedCompany, unverifiedCompany],
  );
  const expires = new Date(Date.now() + 30 * 86_400_000).toISOString();
  await db.admin.query(
    `INSERT INTO public.jobs(id, company_id, slug, title, status, category, contract_type, city, region,
       published_at, expires_at, default_locale)
     VALUES ($1, $4, 'q-public', 'Magazynier', 'active', 'warehouse', 'permanent', 'Antwerpen', 'Vlaanderen', now(), $6, 'pl'),
            ($2, $4, 'q-draft', 'Szkic', 'draft', 'warehouse', 'permanent', 'Antwerpen', 'Vlaanderen', null, $6, 'pl'),
            ($3, $5, 'q-unverified', 'Ukryta', 'active', 'warehouse', 'permanent', 'Antwerpen', 'Vlaanderen', now(), $6, 'pl')`,
    [publicJob, draftJob, unverifiedJob, verifiedCompany, unverifiedCompany, expires],
  );
  await db.admin.query(`INSERT INTO public.skills(id, slug, name) VALUES ($1, 'q-forklift', 'Forklift')`, [skillId]);
  await db.admin.query(
    `INSERT INTO public.skill_labels(skill_id, locale, kind, label) VALUES ($1, 'nl', 'preferred', 'Heftruck rijden')`,
    [skillId],
  );
  for (const job of [publicJob, draftJob, unverifiedJob]) {
    await db.admin.query(
      `INSERT INTO public.job_skills(job_id, skill_id, skill_label, is_mandatory)
       VALUES ($1, $2, 'Wózek widłowy', true), ($1, null, 'Kompletowanie zamówień', false)`,
      [job, skillId],
    );
    await db.admin.query(
      `INSERT INTO public.job_certificates(job_id, certificate_label) VALUES ($1, 'VCA Basis')`,
      [job],
    );
  }
});

afterAll(async () => {
  await db?.stop();
});

describe('Kwalifikacje publicznej oferty pod rolą anon (#866)', () => {
  it('oferta publiczna oddaje umiejętności i certyfikaty; słownik tylko w języku strony', async () => {
    const pl = await getPublicJobQualifications(db.web, publicJob, 'pl');
    expect(parseJobQualifications(pl.skills, pl.certificates)).toEqual({
      skillsMandatory: [{ label: 'Wózek widłowy', localized: false }],
      skillsOptional: [{ label: 'Kompletowanie zamówień', localized: false }],
      certificates: [{ label: 'VCA Basis', localized: false }],
    });

    const nl = await getPublicJobQualifications(db.web, publicJob, 'nl');
    expect(parseJobQualifications(nl.skills, nl.certificates)?.skillsMandatory).toEqual([
      { label: 'Heftruck rijden', localized: true },
    ]);
  });

  it('nieobsługiwany język = domyślny język serwisu (bez nazw słownika z innego języka)', async () => {
    const rows = await getPublicJobQualifications(db.web, publicJob, 'xx');
    expect(rows.skills.map((row) => row['localized_label'])).toEqual([null, null]);
  });

  it('kontrola ujemna: szkic i oferta firmy niezweryfikowanej nie oddają kwalifikacji (RLS)', async () => {
    for (const job of [draftJob, unverifiedJob]) {
      const rows = await getPublicJobQualifications(db.web, job, 'pl');
      expect(rows).toEqual({ skills: [], certificates: [] });
      expect(parseJobQualifications(rows.skills, rows.certificates)).toBeUndefined();
    }
    // Te same wiersze istnieją — pusty wynik to polityka, nie brak danych.
    const all = await db.admin.query(
      'SELECT count(*)::int AS n FROM public.job_skills WHERE job_id = ANY($1::uuid[])',
      [[draftJob, unverifiedJob]],
    );
    expect(all.rows[0]?.n).toBe(4);
  });
});
