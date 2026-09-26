import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { actAs, realSession } from './support/real-portal';
import { startPortalDb } from './support/portal-db';

/**
 * P1-03 (0190) — materializacja `matches` na PostgreSQL 16: triggery kolejkują podmioty,
 * worker (pula service) liczy `scoreMatch` i zapisuje tylko pary, które baza kwalifikuje.
 * Wiersz = ten sam wynik co dopasowanie live na szczególe oferty (jedno źródło prawdy).
 */

vi.mock('@/lib/db/portal', async () => (await import('./support/real-portal')).realPortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const { runMatchRecompute } = await import('../../src/lib/matching/materialize');
const { getMyJobMatch } = await import('../../src/lib/data/matching');

let visible: string;
let hidden: string;
let minor: string;
let jobId: string;
let blockedJobId: string;
let unverifiedJobId: string;

function db() {
  return realSession.db!;
}

async function drain() {
  for (let i = 0; i < 20; i++) {
    const run = await runMatchRecompute();
    expect(run.failed).toBe(0);
    if (run.subjects === 0) return;
  }
  throw new Error('Kolejka dopasowań nie opróżniła się.');
}

async function completeProfile(profileId: string, searchable: boolean) {
  const { rows } = await db().admin.query(
    `INSERT INTO public.candidate_profiles(profile_id, is_searchable, profile_completed, occupations, categories,
       preferred_contract_types, city, region, radius_km, experience_years, availability, has_driving_license)
     VALUES ($1, $2, true, '{magazynier}', '{warehouse}', '{permanent}', 'Gent', 'Flandria', 30, 3, 'immediate', true)
     RETURNING id`,
    [profileId, searchable],
  );
  await db().admin.query(`INSERT INTO public.candidate_skills(candidate_profile_id, skill_label) VALUES ($1, 'wózek widłowy')`, [rows[0].id]);
  await db().admin.query(
    `INSERT INTO public.candidate_certificates(candidate_profile_id, certificate_label, expires_at) VALUES ($1, 'VCA', '2000-01-01')`,
    [rows[0].id],
  );
}

async function job(companyId: string, slug: string) {
  const { rows } = await db().admin.query(
    `INSERT INTO public.jobs(company_id, slug, title, status, category, contract_type, city, region, published_at,
       occupation, min_experience_years, requires_driving_license)
     VALUES ($1, $2, 'Magazynier', 'active', 'warehouse', 'permanent', 'Gent', 'Flandria', now(), 'magazynier', 2, true)
     RETURNING id`,
    [companyId, `${slug}-${randomUUID().slice(0, 8)}`],
  );
  await db().admin.query(`INSERT INTO public.job_skills(job_id, skill_label, is_mandatory) VALUES ($1, 'wózek widłowy', true)`, [rows[0].id]);
  await db().admin.query(`INSERT INTO public.job_certificates(job_id, certificate_label) VALUES ($1, 'VCA')`, [rows[0].id]);
  return rows[0].id as string;
}

async function matchRows() {
  const { rows } = await db().admin.query(
    `SELECT candidate_id, job_id, score, matched, missing, strengths, mandatory_met, mandatory_total, summary_key
       FROM public.matches ORDER BY candidate_id, job_id`,
  );
  return rows;
}

beforeAll(async () => {
  realSession.db = await startPortalDb();
  visible = await db().createUser('candidate', 'nl');
  hidden = await db().createUser('candidate', 'fr');
  minor = randomUUID();
  await db().admin.query(`INSERT INTO auth.users(id, email, name, raw_user_meta_data) VALUES ($1, $2, 'Test', $3::jsonb)`,
    [minor, `${minor}@example.invalid`, JSON.stringify({ role: 'candidate', locale: 'pl' })]);
  await db().admin.query('SELECT public.record_candidate_age_attestation($1, 16, $2)', [minor, 'pl']);
  const company = async (status: string) => (await db().admin.query(
    `INSERT INTO public.companies(name, status) VALUES ('Firma', $1) RETURNING id`, [status])).rows[0].id as string;
  const verified = await company('verified');
  const blocked = await company('verified');
  const unverified = await company('unverified');
  jobId = await job(verified, 'mp');
  blockedJobId = await job(blocked, 'mp-blocked');
  unverifiedJobId = await job(unverified, 'mp-unverified');
  await completeProfile(visible, true);
  await completeProfile(hidden, false);
  // 16–17: baza nie pozwala na widoczność (0126) — profil ukończony, niewyszukiwalny.
  await completeProfile(minor, false);
  await db().admin.query(`INSERT INTO public.candidate_company_blocks(candidate_id, company_id) VALUES ($1, $2)`, [visible, blocked]);
}, 180_000);

afterAll(async () => {
  await realSession.db?.stop();
});

describe('materializacja matches (P1-03)', () => {
  it('worker zapisuje tylko kwalifikującą się parę — ten sam wynik co dopasowanie live', async () => {
    await drain();
    const rows = await matchRows();
    expect(rows.map((r) => [r.candidate_id, r.job_id])).toEqual([[visible, jobId]]);
    expect(rows.some((r) => [blockedJobId, unverifiedJobId].includes(r.job_id))).toBe(false);
    expect(rows.some((r) => [hidden, minor].includes(r.candidate_id))).toBe(false);

    actAs({ id: visible, role: 'candidate' });
    const live = await getMyJobMatch(jobId);
    expect(live.status).toBe('ok');
    if (live.status !== 'ok') return;
    expect(rows[0]).toMatchObject({
      score: live.result.score,
      matched: live.result.matched,
      missing: live.result.missing,
      strengths: live.result.strengths,
      mandatory_met: live.result.mandatoryMet,
      mandatory_total: live.result.mandatoryTotal,
      summary_key: live.result.summaryKey,
    });
    // Wygasły certyfikat (2000-01-01) liczony jako wygasły w obu ścieżkach (data jako tekst).
    expect(live.result.expiredCertificates).toEqual(['VCA']);
    const { rows: queue } = await db().admin.query('SELECT count(*)::int AS n FROM public.match_recompute_queue');
    expect(queue[0].n).toBe(0);
  });

  it('ukrycie profilu i wycofanie oferty usuwają wiersz przy kolejnym przebiegu', async () => {
    await db().admin.query('UPDATE public.candidate_profiles SET is_searchable = false WHERE profile_id = $1', [visible]);
    await drain();
    expect(await matchRows()).toEqual([]);

    await db().admin.query('UPDATE public.candidate_profiles SET is_searchable = true WHERE profile_id = $1', [visible]);
    await drain();
    expect((await matchRows()).map((r) => r.job_id)).toEqual([jobId]);

    await db().admin.query(`UPDATE public.jobs SET status = 'paused' WHERE id = $1`, [jobId]);
    await drain();
    expect(await matchRows()).toEqual([]);
  });

  it('odblokowanie firmy i weryfikacja firmy dodają pary (triggery blokady i statusu firmy)', async () => {
    await db().admin.query(`UPDATE public.jobs SET status = 'active' WHERE id = $1`, [jobId]);
    await db().admin.query('DELETE FROM public.candidate_company_blocks WHERE candidate_id = $1', [visible]);
    await db().admin.query(
      `UPDATE public.companies SET status = 'verified' WHERE id = (SELECT company_id FROM public.jobs WHERE id = $1)`,
      [unverifiedJobId],
    );
    await drain();
    expect((await matchRows()).map((r) => r.job_id).sort()).toEqual([jobId, blockedJobId, unverifiedJobId].sort());
  });
});
