import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import { RECRUITMENT_EMAIL_TEMPLATES, isRecruitmentEmailTemplate } from '@/lib/email/recruitment-templates';
import { emailFieldsFor } from '@/lib/settings/email-preference-fields';
import { fakeDb, resetFakeDb } from '../helpers/fake-db';
// Alias: nazwa `use*` myli regułę react-hooks/rules-of-hooks (to nie hook Reacta, tylko beforeEach/afterEach).
import { useClassifiedsMode as classifiedsModeInTests, useRecruitmentMode as recruitmentModeInTests } from '../helpers/portal-mode';

/**
 * #1145 — decyzja produktowa: portal ogłoszeniowy. Powiadomienia i e-maile bez zdarzeń
 * rekrutacyjnych: lista szablonów SQL = lustro TS, linki starych powiadomień nie prowadzą do
 * wyłączonych tras, preferencje bez kategorii rekrutacyjnych (zapis nie nadpisuje ukrytych
 * kolumn), teksty bez „dopasowania do profilu”, demo bez zdarzeń procesu.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('next-intl/server', () => ({
  getTranslations: async () => (key: string) => key,
}));

const ROOT = join(__dirname, '..', '..');
const PROFILE = '11111111-1111-4111-8111-111111111111';

/** Lista szablonów z najnowszej definicji `email_recruitment_template` w migracjach. */
function sqlTemplates(sql: string): string[] {
  const body = /function public\.email_recruitment_template\(p_template text\)[\s\S]*?array\[([\s\S]*?)\]/.exec(sql)?.[1] ?? '';
  return [...body.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]!);
}
function latestTemplateMigration(): string {
  const files = readdirSync(join(ROOT, 'supabase/migrations')).filter((f) => f.endsWith('.sql')).sort();
  const sql = files
    .map((f) => readFileSync(join(ROOT, 'supabase/migrations', f), 'utf8'))
    .filter((s) => s.includes('function public.email_recruitment_template('));
  return sql.at(-1) ?? '';
}

describe('kolejka e-mail: szablony rekrutacyjne (SQL ↔ TS)', () => {
  it('lista w SQL = lustro TS (kolejność bez znaczenia)', () => {
    expect([...sqlTemplates(latestTemplateMigration())].sort()).toEqual([...RECRUITMENT_EMAIL_TEMPLATES].sort());
  });

  it('kontrola ujemna: usunięcie szablonu z listy SQL jest wykrywane', () => {
    const mutated = latestTemplateMigration().replace("'newMessage', ", '');
    expect([...sqlTemplates(mutated)].sort()).not.toEqual([...RECRUITMENT_EMAIL_TEMPLATES].sort());
  });

  it('powód wygaszenia jest pierwszą przyczyną w email_delivery_suppression_reason', () => {
    const sql = latestTemplateMigration();
    const fn = sql.slice(sql.indexOf('function public.email_delivery_suppression_reason('));
    expect(fn.indexOf('suppressed_feature_disabled')).toBeGreaterThan(0);
    expect(fn.indexOf('suppressed_feature_disabled')).toBeLessThan(fn.indexOf('suppressed_address'));
  });

  it('szablony ogłoszeniowe poza listą (alert, status firmy, konto, zespół, moderacja)', () => {
    for (const t of ['jobMatch', 'companyVerified', 'companyRejected', 'jobPublished', 'accountConfirmation',
      'passwordReset', 'teamInvitation', 'reportReceived', 'newsletter']) {
      expect(isRecruitmentEmailTemplate(t), t).toBe(false);
    }
  });
});

/** Trasy wyłączone w trybie ogłoszeniowym (404) — epik #1128. */
const DISABLED_PREFIXES = [
  '/candidate/aplikacje',
  '/candidate/propozycje',
  '/candidate/oferty-polecane',
  '/candidate/wiadomosci',
  '/candidate/profil',
  '/candidate/onboarding',
  '/employer/aplikacje',
  '/employer/kandydaci',
  '/employer/wiadomosci',
];
const ENTITY_TYPES = [
  'application', 'offer', 'conversation', 'job_terms', 'job', 'company', 'saved_search',
  'company_invitation', 'moderation', 'moderation_decision', 'screening_review', 'report', '', 'nieznany',
];
const hitsDisabled = (href: string) =>
  DISABLED_PREFIXES.some((p) => href === p || href.startsWith(`${p}/`) || href.startsWith(`${p}?`));

describe('resolveHref: cele powiadomień w trybie ogłoszeniowym', () => {
  classifiedsModeInTests();

  it('żaden entity_type × rola nie prowadzi do wyłączonej trasy', async () => {
    const { resolveHref } = await import('@/lib/data/notifications');
    const bad: string[] = [];
    for (const entity of ENTITY_TYPES) {
      for (const role of ['candidate', 'employer']) {
        const href = resolveHref(entity, role, PROFILE);
        if (hitsDisabled(href)) bad.push(`${entity}/${role} → ${href}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('demo: bez zdarzeń rekrutacyjnych (tylko alerty wyszukiwań i status firmy)', async () => {
    const { demoNotificationSeeds } = await import('@/lib/data/notifications');
    for (const role of ['candidate', 'employer'] as const) {
      for (const seed of demoNotificationSeeds(role, false)) {
        expect(seed.type, role).not.toMatch(/^(application_|offer_|message_received)/);
        expect(['application', 'offer', 'conversation', 'job_terms', 'job']).not.toContain(seed.entityType);
      }
    }
  });
});

describe('resolveHref: kontrola ujemna w trybie RECRUITMENT', () => {
  recruitmentModeInTests();

  it('te same cele prowadzą do tras rekrutacyjnych (test wykryłby brak bramki)', async () => {
    const { resolveHref, demoNotificationSeeds } = await import('@/lib/data/notifications');
    expect(hitsDisabled(resolveHref('application', 'candidate'))).toBe(true);
    expect(hitsDisabled(resolveHref('conversation', 'employer', PROFILE))).toBe(true);
    expect(demoNotificationSeeds('candidate', true).some((s) => s.type === 'message_received')).toBe(true);
  });
});

describe('preferencje e-mail bez kategorii rekrutacyjnych', () => {
  it('formularz w trybie ogłoszeniowym: tylko alerty wyszukiwań i marketing', () => {
    expect(emailFieldsFor('candidate', false)).toEqual(['emailJobMatches', 'emailMarketing']);
    expect(emailFieldsFor('employer', false)).toEqual(['emailMarketing']);
    // Kontrola ujemna: tryb RECRUITMENT = pełna lista.
    expect(emailFieldsFor('candidate', true)).toContain('emailApplications');
  });

  describe('zapis w trybie ogłoszeniowym', () => {
    classifiedsModeInTests();
    beforeEach(() => vi.resetModules());

    const input = {
      emailApplications: true, emailOffers: true, emailMessages: true,
      emailJobMatches: false, emailMarketing: true, pushEnabled: false, inAppEnabled: true, locale: 'pl',
    };

    it('ukryte kolumny z bazy (FOR UPDATE), nie z wejścia klienta', async () => {
      resetFakeDb({ id: PROFILE, role: 'candidate' })
        .rows('notification-preferences.recruitment-columns', [
          { email_applications: false, email_offers: false, email_messages: false },
        ])
        .rpc('set_notification_preferences', null);
      const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
      const { emailConsentWordingVersion } = await import('@/lib/email/consent-wording');
      expect(await updateNotificationPreferences(input)).toEqual({ ok: true });
      const [call] = fakeDb.callsTo('set_notification_preferences');
      expect(JSON.parse(call!.args['p_prefs'] as string)).toEqual({
        email_applications: false, email_offers: false, email_messages: false,
        email_job_matches: false, email_marketing: true, push_enabled: false, in_app_enabled: true,
      });
      expect(fakeDb.callsTo('notification-preferences.recruitment-columns')[0]?.text).toMatch(/FOR UPDATE/);
      // Wersja treści zgody = pola pokazane w trybie ogłoszeniowym.
      expect(call!.args['p_wording_version']).toBe(emailConsentWordingVersion('pl', 'candidate', false));
      expect(call!.args['p_wording_version']).not.toBe(emailConsentWordingVersion('pl', 'candidate', true));
    });

    it('brak wiersza preferencji → wartości domyślne kolumn (nie wejście klienta)', async () => {
      resetFakeDb({ id: PROFILE, role: 'employer' })
        .rows('notification-preferences.recruitment-columns', [])
        .rpc('set_notification_preferences', null);
      const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
      expect(await updateNotificationPreferences({ ...input, emailApplications: false })).toEqual({ ok: true });
      const prefs = JSON.parse(fakeDb.callsTo('set_notification_preferences')[0]!.args['p_prefs'] as string);
      expect(prefs).toMatchObject({ email_applications: true, email_offers: true, email_messages: true });
    });
  });

  describe('kontrola ujemna: tryb RECRUITMENT zapisuje wejście', () => {
    recruitmentModeInTests();
    beforeEach(() => vi.resetModules());

    it('bez odczytu ukrytych kolumn', async () => {
      resetFakeDb({ id: PROFILE, role: 'candidate' }).rpc('set_notification_preferences', null);
      const { updateNotificationPreferences } = await import('@/lib/actions/notification-preferences');
      expect(await updateNotificationPreferences({
        emailApplications: false, emailOffers: true, emailMessages: false,
        emailJobMatches: true, emailMarketing: false, pushEnabled: false, inAppEnabled: true, locale: 'en',
      })).toEqual({ ok: true });
      expect(fakeDb.callsTo('notification-preferences.recruitment-columns')).toHaveLength(0);
      expect(JSON.parse(fakeDb.callsTo('set_notification_preferences')[0]!.args['p_prefs'] as string))
        .toMatchObject({ email_applications: false, email_messages: false });
    });
  });
});

describe('teksty: bez „dopasowania do profilu” (4 języki)', () => {
  const PROFILE_WORDING = /profil|profiel|dopasowan|afgestemd|adaptée|matched to/i;
  it.each([['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const)('%s', (_locale, m) => {
    const texts = [
      m.notifications.itemJobMatch,
      m.settings.emailJobMatchesLabel,
      m.settings.emailJobMatchesDescription,
      m.emailUnsubscribe.category.job_matches,
    ];
    for (const text of texts) expect(text).not.toMatch(PROFILE_WORDING);
  });

  it('kontrola ujemna: dawne brzmienie jest wykrywane', () => {
    expect('Nowa oferta dopasowana do Twojego profilu').toMatch(PROFILE_WORDING);
    expect('Vacatures die goed bij je profiel passen.').toMatch(PROFILE_WORDING);
  });
});
