import * as React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';

import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

vi.mock('@/lib/actions/notification-preferences', () => ({ updateNotificationPreferences: vi.fn() }));

import { NotificationPreferencesForm } from '@/components/settings/NotificationPreferencesForm';
import { DEFAULT_NOTIFICATION_PREFERENCES } from '@/lib/data/notification-preferences';
import {
  INAPP_REQUIRED_SYSTEM_KINDS,
  isInAppRequiredNotification,
} from '@/lib/notifications/service-messages';
import { descriptionKey } from '@/lib/settings/email-preference-fields';

/**
 * #1120 (NOTIF-04): opt-out „Powiadomienia w aplikacji” nie może ukrywać decyzji, które nie
 * mają odpowiednika e-mail. Reguła w bazie: `notification_inapp_required` (migracja 0942).
 */

const ROOT = path.resolve(__dirname, '../..');
const MIGRATION_DIRS = ['supabase/migrations', 'database/bootstrap', 'database/auth'];

function migrationFiles(): string[] {
  const files: string[] = [];
  for (const dir of MIGRATION_DIRS) {
    let names: string[] = [];
    try {
      names = readdirSync(path.join(ROOT, dir));
    } catch {
      continue;
    }
    for (const n of names) if (n.endsWith('.sql')) files.push(path.join(dir, n));
  }
  return files.sort((a, b) => path.basename(a).localeCompare(path.basename(b)));
}

const FN_RE = /create\s+or\s+replace\s+function\s+(?:public\.)?(\w+)\s*\(.*?\$(\w*)\$(.*?)\$\2\$/gis;

/** Najnowsze definicje funkcji (nazwa → ciało) z podanych plików SQL w kolejności numerów. */
function latestDefinitions(sources: readonly string[]): Map<string, string> {
  const defs = new Map<string, string>();
  for (const sql of sources) {
    for (const m of sql.matchAll(FN_RE)) defs.set(m[1]!, m[3]!);
  }
  return defs;
}

function allDefinitions(): Map<string, string> {
  return latestDefinitions(migrationFiles().map((f) => readFileSync(path.join(ROOT, f), 'utf8')));
}

/** Rodzaje (`data.kind`) z reguły SQL `notification_inapp_required`. */
function sqlRequiredKinds(defs: Map<string, string>): string[] | null {
  const body = defs.get('notification_inapp_required');
  if (!body) return null;
  const list = /in\s*\(([^)]*)\)/i.exec(body);
  if (!list) return null;
  return [...list[1]!.matchAll(/'(\w+)'/g)].map((m) => m[1]!).sort();
}

/**
 * Powiadomienia `system` z `data.kind` wstawiane w funkcjach bez żadnego e-maila. Każde musi być
 * na liście wiadomości serwisowych albo tu, z uzasadnieniem.
 */
const NO_EMAIL_EXCEPTIONS: Record<string, string> = {
  // Wyłączone w trybie ogłoszeniowym (#1128): przegląd pytań screeningowych → RECRUITMENT_DISABLED.
  screening_review: 'recruitment',
  // Zmiana warunków dla kandydatów z aktywną aplikacją — proces rekrutacyjny, pomijany przez 0175.
  job_terms_changed: 'recruitment',
};

function inAppOnlyKinds(defs: Map<string, string>): Set<string> {
  const kinds = new Set<string>();
  for (const body of defs.values()) {
    if (!/insert\s+into\s+public\.notifications/i.test(body) || /enqueue_email/i.test(body)) continue;
    for (const m of body.matchAll(/'kind',\s*'(\w+)'/g)) kinds.add(m[1]!);
  }
  return kinds;
}

describe('wiadomości serwisowe a opt-out in-app (#1120)', () => {
  const defs = allDefinitions();

  it('lista w TS = reguła w bazie', () => {
    expect(sqlRequiredKinds(defs)).toEqual([...INAPP_REQUIRED_SYSTEM_KINDS].sort());
  });

  it('najnowszy filtr preferencji woła regułę przed odczytem in_app_enabled', () => {
    const body = defs.get('filter_notification_by_preference') ?? '';
    const rule = body.indexOf('notification_inapp_required');
    expect(rule).toBeGreaterThan(-1);
    expect(rule).toBeLessThan(body.indexOf('in_app_enabled'));
  });

  it('każde powiadomienie systemowe bez e-maila jest wiadomością serwisową albo ma uzasadniony wyjątek', () => {
    const missing = [...inAppOnlyKinds(defs)].filter(
      (k) => !(INAPP_REQUIRED_SYSTEM_KINDS as readonly string[]).includes(k) && !(k in NO_EMAIL_EXCEPTIONS),
    );
    expect(missing).toEqual([]);
    // Wyjątki nie mogą być nieaktualne.
    for (const k of Object.keys(NO_EMAIL_EXCEPTIONS)) expect(inAppOnlyKinds(defs).has(k)).toBe(true);
  });

  it('kontrola ujemna: definicje sprzed 0942 nie mają reguły, a strażnik wskazuje decyzje bez e-maila', () => {
    const before = latestDefinitions(
      migrationFiles()
        .filter((f) => !path.basename(f).startsWith('0942_'))
        .map((f) => readFileSync(path.join(ROOT, f), 'utf8')),
    );
    expect(sqlRequiredKinds(before)).toBeNull();
    expect(before.get('filter_notification_by_preference')).not.toContain('notification_inapp_required');
    const missing = [...inAppOnlyKinds(before)].filter((k) => !(k in NO_EMAIL_EXCEPTIONS));
    expect(missing.sort()).toEqual([...INAPP_REQUIRED_SYSTEM_KINDS].sort());
  });

  it('lustro TS: tylko typ system i rodzaj z listy', () => {
    expect(isInAppRequiredNotification('system', { kind: 'company_links' })).toBe(true);
    expect(isInAppRequiredNotification('system', { kind: 'job_content_review' })).toBe(true);
    expect(isInAppRequiredNotification('system', { kind: 'company_status' })).toBe(false);
    expect(isInAppRequiredNotification('system', null)).toBe(false);
    expect(isInAppRequiredNotification('job_match', { kind: 'company_links' })).toBe(false);
  });
});

const translations = { pl, nl, fr, en } as const;
type Loc = keyof typeof translations;

afterEach(cleanup);

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

function renderForm(locale: Loc, role: 'candidate' | 'employer') {
  return render(
    <NextIntlClientProvider locale={locale} messages={translations[locale]}>
      <NotificationPreferencesForm defaultValues={DEFAULT_NOTIFICATION_PREFERENCES} role={role} />
    </NextIntlClientProvider>,
  );
}

describe('opis przełącznika in-app (#1120)', () => {
  it('pracodawca ma własny klucz opisu, kandydat ogólny', () => {
    expect(descriptionKey('inAppEnabled', 'employer')).toBe('employerInAppEnabledDescription');
    expect(descriptionKey('inAppEnabled', 'candidate')).toBe('inAppEnabledDescription');
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)('pracodawca widzi, czego wyłączenie nie ukrywa (%s)', (locale) => {
    const s = translations[locale].settings;
    renderForm(locale, 'employer');
    const box = screen.getByRole('checkbox', { name: s.inAppEnabledLabel });
    expect(box).toHaveAccessibleDescription(s.employerInAppEnabledDescription);
    // Kontrola ujemna: opis ogólny (bez listy wiadomości serwisowych) nie wystarcza pracodawcy.
    expect(s.employerInAppEnabledDescription).not.toBe(s.inAppEnabledDescription);
    expect(s.employerInAppEnabledDescription.startsWith(s.inAppEnabledDescription)).toBe(true);
  });

  it.each(['pl', 'nl', 'fr', 'en'] as const)('kandydat bez zmian (%s)', (locale) => {
    const s = translations[locale].settings;
    renderForm(locale, 'candidate');
    expect(screen.getByRole('checkbox', { name: s.inAppEnabledLabel })).toHaveAccessibleDescription(
      s.inAppEnabledDescription,
    );
  });
});
