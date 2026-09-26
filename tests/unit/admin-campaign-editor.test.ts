import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { assertRenderableJobs, type NewsletterJob } from '@/emails/newsletter';
import { routing, type Locale } from '@/i18n/routing';
import { createEmailCampaignRevision } from '@/lib/actions/admin-campaigns';
import {
  CAMPAIGN_JOB_LIMITS,
  CAMPAIGN_SLUG_MAX,
  campaignContentFromForm,
  campaignEditorErrorOrder,
  campaignEditorErrors,
  campaignFormFromContent,
  emptyCampaignForm,
  type CampaignEditorForm,
} from '@/lib/admin/campaign-editor';
import { campaignPreview } from '@/lib/admin/campaigns';
import { AUDIT_ACTION_KEY } from '@/lib/admin/list-params';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #45 — edytor rewizji kampanii e-mail w panelu admina (`/admin/kampanie/nowa`, „Nowa
 * rewizja”): walidacja pól = reguły workera + podgląd (jedno źródło), treść w kształcie
 * workera, akcja pod sesją admina z kluczem idempotencji (RPC 0202). Kontrole ujemne: brak
 * języka / placeholder / demo = błąd przy polu i brak RPC; walidator pomijający język nie
 * przeszedłby testu zgodności z workerem.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const ADMIN_ID = '00000000-0000-4000-8000-00000000a001';
const CLIENT_KEY = '5b3a1c2d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
const NEW_ID = '7c0e8f4c-2b1d-4c3e-9f7a-1d2e3f4a5b6c';
const MIGRATION = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0202_admin_email_campaign_editor.sql'),
  'utf8',
);

function fullForm(): CampaignEditorForm {
  const form = emptyCampaignForm('newsletter-pazdziernik');
  for (const locale of routing.locales) {
    form.content[locale] = [
      { slug: `magazynier-${locale}`, title: `Magazynier ${locale}`, city: 'Gent', salary: '' },
    ];
  }
  return form;
}

function withJob(locale: Locale, patch: Partial<CampaignEditorForm['content'][Locale][number]>) {
  const form = fullForm();
  form.content[locale] = [{ ...form.content[locale][0]!, ...patch }];
  return form;
}

/** Czy worker wyrenderowałby treść danego języka (ta sama treść, którą zapisze edytor). */
function workerAccepts(form: CampaignEditorForm, locale: Locale): boolean {
  const jobs = campaignContentFromForm(form)[locale].jobs as NewsletterJob[];
  try {
    assertRenderableJobs(jobs, locale);
    return true;
  } catch {
    return false;
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFakeDb(null);
});

describe('walidacja edytora = reguły workera i podglądu', () => {
  it('pełna treść w 4 językach: bez błędów, podgląd i worker akceptują', () => {
    const form = fullForm();
    expect(campaignEditorErrors(form)).toEqual({});
    expect(campaignPreview(campaignContentFromForm(form)).every((p) => p.status === 'ok')).toBe(true);
    for (const locale of routing.locales) expect(workerAccepts(form, locale)).toBe(true);
    // Kształt workera: język oferty = język wpisu, isDemo=false, pusta stawka pominięta.
    expect(campaignContentFromForm(form).nl.jobs[0]).toEqual({
      locale: 'nl',
      slug: 'magazynier-nl',
      title: 'Magazynier nl',
      city: 'Gent',
      isDemo: false,
    });
  });

  it('brak treści w jednym języku → błąd przy konkretnym polu tego języka (Invariant #1)', () => {
    const form = withJob('fr', { title: '   ', city: '' });
    const errors = campaignEditorErrors(form);
    expect(errors).toEqual({ 'fr.0.title': 'required', 'fr.0.city': 'required' });
    expect(campaignEditorErrorOrder(form, errors)[0]).toBe('fr.0.title');
    // Worker odrzuciłby tę samą treść — edytor nie zapisze listu, którego nie da się wysłać.
    expect(workerAccepts(form, 'fr')).toBe(false);
    // Podgląd (także w szczególe rewizji) pokazuje ten język jako niepoprawny.
    const preview = campaignPreview(campaignContentFromForm(form));
    expect(preview.filter((p) => p.status === 'invalid').map((p) => p.locale)).toEqual(['fr']);
  });

  it('KONTROLA UJEMNA: każdy przypadek odrzucany przez workera ma błąd w edytorze', () => {
    const bad: CampaignEditorForm[] = [
      withJob('en', { slug: 'Zły Slug' }),
      withJob('pl', { title: 'Cześć {{imie}}' }),
      withJob('nl', { salary: '{{stawka}}' }),
      withJob('fr', { slug: '' }),
    ];
    for (const form of bad) {
      const failing = routing.locales.filter((l) => !workerAccepts(form, l));
      expect(failing).toHaveLength(1);
      const errors = Object.keys(campaignEditorErrors(form));
      expect(errors.length).toBeGreaterThan(0);
      expect(errors.every((key) => key.startsWith(`${failing[0]}.`))).toBe(true);
    }
    // Walidator pomijający któryś język (np. tylko pierwszy) nie wykryłby błędu w `en`.
    const onlyFirstLocale = (form: CampaignEditorForm) =>
      Object.keys(campaignEditorErrors(form)).filter((k) => k.startsWith(`${routing.locales[0]}.`));
    expect(onlyFirstLocale(bad[0]!)).toEqual([]);
    expect(Object.keys(campaignEditorErrors(bad[0]!))).toEqual(['en.0.slug']);
  });

  it('liczba ofert 1–3, limity długości i slug kampanii', () => {
    const none = fullForm();
    none.content.nl = [];
    expect(campaignEditorErrors(none)).toEqual({ 'nl.jobs': 'jobsCount' });
    const four = fullForm();
    four.content.pl = Array.from({ length: 4 }, (_, i) => ({ slug: `o-${i}`, title: 'T', city: 'C', salary: '' }));
    expect(campaignEditorErrors(four)).toEqual({ 'pl.jobs': 'jobsCount' });
    expect(campaignEditorErrors(withJob('en', { title: 'x'.repeat(CAMPAIGN_JOB_LIMITS.title + 1) }))).toEqual({
      'en.0.title': 'tooLong',
    });
    expect(campaignEditorErrors({ ...fullForm(), slug: '' })).toEqual({ slug: 'required' });
    expect(campaignEditorErrors({ ...fullForm(), slug: 'Zła-Nazwa' })).toEqual({ slug: 'slug' });
    expect(campaignEditorErrors({ ...fullForm(), slug: 'a'.repeat(CAMPAIGN_SLUG_MAX + 1) })).toEqual({
      slug: 'tooLong',
    });
  });

  it('nowa rewizja: formularz z treści rewizji; demo i brakujący język nie przechodzą bez uzupełnienia', () => {
    const content = campaignContentFromForm(fullForm());
    const { en: _en, ...withoutEn } = content;
    const form = campaignFormFromContent('newsletter-pazdziernik', {
      ...withoutEn,
      pl: { jobs: [{ locale: 'pl', slug: 'demo-pl', title: 'Demo', city: 'Gent', isDemo: true, salary: '2 400 EUR' }] },
    });
    expect(form.slug).toBe('newsletter-pazdziernik');
    expect(form.content.pl[0]).toEqual({ slug: 'demo-pl', title: 'Demo', city: 'Gent', salary: '2 400 EUR' });
    expect(form.content.en).toEqual([{ slug: '', title: '', city: '', salary: '' }]);
    expect(Object.keys(campaignEditorErrors(form)).sort()).toEqual(['en.0.city', 'en.0.slug', 'en.0.title']);
    // isDemo nie jest polem — nowa treść zawsze zapisuje isDemo=false.
    expect((campaignContentFromForm(form).pl.jobs[0] as { isDemo: boolean }).isDemo).toBe(false);
  });
});

describe('migracja 0202 (kontrakt)', () => {
  it('tylko admin, idempotencja po kluczu, audyt bez treści, EXECUTE tylko authenticated', () => {
    expect(MIGRATION).toContain('create or replace function public.admin_create_email_campaign_revision(');
    expect(MIGRATION).toContain("if not public.is_admin() then raise exception 'PERMISSION_DENIED'");
    expect(MIGRATION).toContain('where client_key = p_client_key');
    expect(MIGRATION).toContain('v_id := public.create_email_campaign_revision(p_slug, p_content);');
    expect(MIGRATION).toMatch(
      /write_audit\('email_campaign\.revision_created', 'email_campaign', v_id, null,\s*jsonb_build_object\('status', 'draft', 'slug', p_slug, 'revision', v_revision\)\)/,
    );
    expect(MIGRATION).toContain(
      'revoke all on function public.admin_create_email_campaign_revision(uuid, text, jsonb) from public, anon;',
    );
    expect(MIGRATION).toContain(
      'grant execute on function public.admin_create_email_campaign_revision(uuid, text, jsonb) to authenticated;',
    );
    expect(AUDIT_ACTION_KEY['email_campaign.revision_created']).toBe('auditActionCampaignRevisionCreated');
  });

  it('limity długości w bazie = limity edytora', () => {
    for (const [field, max] of Object.entries(CAMPAIGN_JOB_LIMITS)) {
      expect(MIGRATION).toContain(`char_length(j ->> '${field}') <= ${max}`);
    }
    expect(MIGRATION).toContain(`char_length(p_slug) > ${CAMPAIGN_SLUG_MAX}`);
  });
});

describe('createEmailCampaignRevision', () => {
  function mockAdmin(result: unknown = NEW_ID, rpcError?: string) {
    resetFakeDb({ id: ADMIN_ID, role: 'admin' });
    fakeDb.rpc('admin_create_email_campaign_revision', () => {
      if (rpcError) throw pgError('P0001', rpcError);
      return result;
    });
  }

  it('zapis pod sesją admina: klucz klienta, slug i treść w kształcie workera', async () => {
    mockAdmin();
    await expect(createEmailCampaignRevision(CLIENT_KEY, fullForm())).resolves.toEqual({ ok: true, id: NEW_ID });
    const [call] = fakeDb.callsTo('admin_create_email_campaign_revision');
    expect(call).toMatchObject({ as: ADMIN_ID, args: { p_client_key: CLIENT_KEY, p_slug: 'newsletter-pazdziernik' } });
    const content = JSON.parse(String(call!.args.p_content)) as Record<string, { jobs: unknown[] }>;
    expect(Object.keys(content)).toEqual([...routing.locales]);
    expect(campaignPreview(content).every((p) => p.status === 'ok')).toBe(true);
    // Ponowienie (np. po zerwanym połączeniu) wysyła TEN SAM klucz — duplikat odrzuca baza.
    await createEmailCampaignRevision(CLIENT_KEY, fullForm());
    const calls = fakeDb.callsTo('admin_create_email_campaign_revision');
    expect(calls.map((c) => c.args.p_client_key)).toEqual([CLIENT_KEY, CLIENT_KEY]);
  });

  it('KONTROLA UJEMNA: brak języka / placeholder → błędy przy polach, BEZ wywołania bazy', async () => {
    mockAdmin();
    await expect(createEmailCampaignRevision(CLIENT_KEY, withJob('en', { title: '' }))).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      fields: { 'en.0.title': 'required' },
    });
    await expect(createEmailCampaignRevision(CLIENT_KEY, withJob('nl', { city: 'Gent {{x}}' }))).resolves.toMatchObject({
      fields: { 'nl.0.city': 'placeholder' },
    });
    const { en: _en, ...content } = fullForm().content;
    await expect(createEmailCampaignRevision(CLIENT_KEY, { slug: 'x', content })).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('zły klucz, brak sesji, błędy RPC → stabilne kody; demo nic nie zapisuje', async () => {
    mockAdmin();
    await expect(createEmailCampaignRevision('nie-uuid', fullForm())).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
    });
    expect(fakeDb.calls).toHaveLength(0);

    mockAdmin(NEW_ID, 'VALIDATION_FAILED: slug');
    await expect(createEmailCampaignRevision(CLIENT_KEY, fullForm())).resolves.toEqual({
      ok: false,
      error: 'VALIDATION_FAILED',
      fields: { slug: 'slug' },
    });
    mockAdmin(NEW_ID, 'PERMISSION_DENIED');
    await expect(createEmailCampaignRevision(CLIENT_KEY, fullForm())).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });

    resetFakeDb(null);
    await expect(createEmailCampaignRevision(CLIENT_KEY, fullForm())).resolves.toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });

    mockAdmin();
    fakeSession.configured = false;
    await expect(createEmailCampaignRevision(CLIENT_KEY, fullForm())).resolves.toEqual({ ok: true, demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});
