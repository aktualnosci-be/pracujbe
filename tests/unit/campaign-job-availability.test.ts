import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { routing } from '@/i18n/routing';
import { activateEmailCampaign, createEmailCampaignRevision } from '@/lib/actions/admin-campaigns';
import { CAMPAIGN_EDITOR_ERROR_KEY, emptyCampaignForm, type CampaignEditorForm } from '@/lib/admin/campaign-editor';
import { parseUnavailableJobSlugs, unavailableJobFieldErrors } from '@/lib/admin/campaign-job-availability';
import { getEmailCampaign } from '@/lib/data/admin-campaigns';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #720 — kampania e-mail tylko z ofertami publicznymi (migracja 0954). Baza odrzuca zapis
 * i aktywację (`CAMPAIGN_JOB_UNAVAILABLE: slugi`), panel pokazuje błąd przy polu sluga oferty,
 * komunikat aktywacji i ostrzeżenie w szczególe rewizji. Kontrole ujemne: inny błąd bazy nie
 * jest brany za niedostępną ofertę; slug spoza listy nie dostaje błędu.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('next/navigation', () => ({
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND');
  }),
}));
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const CLIENT_KEY = '5b3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const CAMPAIGN_ID = '7c0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0954_gc_batches_campaign_jobs.sql'),
  'utf8',
);

function form(): CampaignEditorForm {
  const f = emptyCampaignForm('newsletter-pazdziernik');
  for (const locale of routing.locales) {
    f.content[locale] = [
      { slug: `magazynier-${locale}`, title: `Magazynier ${locale}`, city: 'Gent', salary: '' },
      { slug: 'wspolna-oferta', title: 'Wspólna', city: 'Gent', salary: '' },
    ];
  }
  return f;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
  for (const [k, v] of Object.entries({
    EMAIL_FROM: 'Pracuj.be <news@example.test>',
    EMAIL_SENDER_IDENTITY: 'Operator testowy',
    EMAIL_SENDER_POSTAL_ADDRESS: 'Rue de Test 1, 1000 Bruxelles',
    EMAIL_UNSUBSCRIBE_SECRET: 'x'.repeat(40),
  })) vi.stubEnv(k, v);
});

describe('parseUnavailableJobSlugs', () => {
  it('odczytuje slugi z komunikatu bazy', () => {
    expect(parseUnavailableJobSlugs('CAMPAIGN_JOB_UNAVAILABLE: a-1,b-2')).toEqual(['a-1', 'b-2']);
    expect(parseUnavailableJobSlugs('ERROR: CAMPAIGN_JOB_UNAVAILABLE: gc-ok\nCONTEXT: PL/pgSQL')).toEqual(['gc-ok']);
  });

  it('KONTROLA UJEMNA: inny błąd → null; śmieci w komunikacie nie trafiają na listę', () => {
    expect(parseUnavailableJobSlugs('VALIDATION_FAILED: kampania')).toBeNull();
    expect(parseUnavailableJobSlugs('CAMPAIGN_JOB_UNAVAILABLE: ok-1,<script>,ZŁY')).toEqual(['ok-1']);
  });
});

describe('unavailableJobFieldErrors', () => {
  it('błąd przy każdym polu sluga z listy (w każdym języku), pozostałe bez błędu', () => {
    const errors = unavailableJobFieldErrors(form(), ['wspolna-oferta', 'magazynier-nl']);
    expect(errors).toEqual({
      'pl.1.slug': 'unavailable',
      'nl.0.slug': 'unavailable',
      'nl.1.slug': 'unavailable',
      'fr.1.slug': 'unavailable',
      'en.1.slug': 'unavailable',
    });
  });

  it('klucz komunikatu istnieje w czterech językach', () => {
    for (const locale of routing.locales) {
      const admin = (JSON.parse(readFileSync(resolve(process.cwd(), 'src/messages', `${locale}.json`), 'utf8')) as {
        admin: Record<string, string>;
      }).admin;
      for (const key of [
        CAMPAIGN_EDITOR_ERROR_KEY.unavailable,
        'campaignJobsUnavailableTitle',
        'campaignJobsUnavailableText',
        'campaignJobsUnavailableActivate',
      ]) {
        expect(admin[key], `${locale}.${key}`).toBeTruthy();
      }
    }
  });
});

describe('akcje panelu', () => {
  it('zapis rewizji: niedostępna oferta → błąd przy polu sluga (bez INTERNAL)', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rpc('admin_create_email_campaign_revision', () => {
      throw pgError('22023', 'CAMPAIGN_JOB_UNAVAILABLE: magazynier-fr');
    });
    await expect(createEmailCampaignRevision(CLIENT_KEY, form())).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      fields: { 'fr.0.slug': 'unavailable' },
    });
  });

  it('KONTROLA UJEMNA: inny błąd walidacji bazy nie oznacza pól jako niedostępnych', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rpc('admin_create_email_campaign_revision', () => {
      throw pgError('22023', 'VALIDATION_FAILED: kampania');
    });
    await expect(createEmailCampaignRevision(CLIENT_KEY, form())).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
  });

  it('aktywacja: niedostępna oferta → reason jobsUnavailable ze slugami', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rpc('admin_activate_email_campaign', () => {
      throw pgError('22023', 'CAMPAIGN_JOB_UNAVAILABLE: a-1,b-2');
    });
    await expect(activateEmailCampaign(CAMPAIGN_ID, 'draft')).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      reason: 'jobsUnavailable',
      slugs: ['a-1', 'b-2'],
    });
  });
});

describe('szczegół rewizji', () => {
  it('zwraca slugi ofert niedostępnych z bazy (service-role, po roli admina)', async () => {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb
      .rows('admin.email-campaign', [
        {
          id: CAMPAIGN_ID, slug: 'newsletter-pazdziernik', revision: 1, template: 'newsletter', status: 'draft',
          created_at: '2026-09-24T10:00:00.000000+00:00', activated_at: null, closed_at: null, content: {},
        },
      ])
      .rows('admin.email-campaign-revisions', [])
      .rows('admin.email-campaign-unavailable-jobs', [{ slugs: ['stara-oferta'] }])
      .rows('admin.email-campaign-recipients', []);
    const detail = await getEmailCampaign(CAMPAIGN_ID);
    expect(detail.status === 'ok' && detail.campaign.unavailableJobSlugs).toEqual(['stara-oferta']);
    expect(fakeDb.callsTo('admin.email-campaign-unavailable-jobs')[0]).toMatchObject({ as: 'service' });
  });

  it('demo: pusta lista', async () => {
    fakeSession.configured = false;
    const detail = await getEmailCampaign('demo-k2');
    expect(detail.status === 'ok' && detail.campaign.unavailableJobSlugs).toEqual([]);
  });
});

describe('migracja 0954 (lustro)', () => {
  it('kontrola przy zapisie, aktywacji, harmonogramie i tuż przed wysyłką', () => {
    for (const fn of [
      'admin_create_email_campaign_revision',
      'admin_activate_email_campaign',
      'process_email_campaigns',
      'email_delivery_send_check',
    ]) {
      const body = MIGRATION.slice(MIGRATION.indexOf(`function public.${fn}(`));
      const end = body.indexOf('end $$;');
      expect(body.slice(0, end), fn).toContain('email_campaign_unavailable_slugs');
    }
    // Warunki dostępności = źródło materiałów kampanii (0102), nie własna kopia.
    expect(MIGRATION).toMatch(/campaign_job_source\(null, j ->> 'slug', e\.k\)/);
  });
});
