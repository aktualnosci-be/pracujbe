import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmailLocaleSettings } from '@/components/settings/EmailLocaleSettings';
import { setEmailLocaleAction } from '@/lib/actions/email-locale';
import { loadEmailLocale } from '@/lib/data/email-locale';
import type { PortalIdentity } from '@/lib/auth/session';
import pl from '@/messages/pl.json';
import nl from '@/messages/nl.json';
import fr from '@/messages/fr.json';
import en from '@/messages/en.json';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * #1049 (Invariant #1) — ustawienie języka e-maili i powiadomień: akcja (RPC pod sesją),
 * odczyt języka zastosowanego przez kolejkę, formularz. Baza: supabase/tests/rls.sql EL1049.
 */

vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));

const USER = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function db(opts: { user?: PortalIdentity | null; rpc?: () => unknown; row?: () => unknown } = {}) {
  resetFakeDb(opts.user === undefined ? ({ id: USER, role: 'candidate' } as PortalIdentity) : opts.user);
  fakeDb
    .rpc('set_my_email_locale', opts.rpc ?? (() => 'nl'))
    .rows('email-locale.own', opts.row ?? (() => []));
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('setEmailLocaleAction (#1049)', () => {
  it('woła set_my_email_locale pod sesją z językiem z walidowanej listy', async () => {
    db();
    expect(await setEmailLocaleAction('nl')).toEqual({ ok: true, locale: 'nl' });
    expect(fakeDb.callsTo('set_my_email_locale')[0]).toMatchObject({ args: { p_locale: 'nl' }, as: USER });
  });

  it.each([['de'], ['NL'], [''], [null], [undefined], [{ locale: 'nl' }], [1]])(
    'odrzuca %j przed bazą (kontrola ujemna: język spoza listy nie trafia do RPC)',
    async (value) => {
      db();
      expect(await setEmailLocaleAction(value)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(fakeDb.calls).toHaveLength(0);
    },
  );

  it('brak sesji i konto admina → PERMISSION_DENIED bez RPC', async () => {
    db({ user: null });
    expect(await setEmailLocaleAction('fr')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    db({ user: { id: USER, role: 'admin' } as PortalIdentity });
    expect(await setEmailLocaleAction('fr')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('błędy bazy → kody użytkowe, bez technikaliów (Invariant #8)', async () => {
    db({ rpc: () => { throw pgError('22023', 'VALIDATION_FAILED: locale'); } });
    expect(await setEmailLocaleAction('en')).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
    db({ rpc: () => { throw pgError('42501', 'PERMISSION_DENIED: profil niedostępny'); } });
    expect(await setEmailLocaleAction('en')).toEqual({ ok: false, error: 'PERMISSION_DENIED' });
    db({ rpc: () => { throw pgError('XX000', 'relation "profiles" does not exist'); } });
    expect(await setEmailLocaleAction('en')).toEqual({ ok: false, error: 'INTERNAL' });
  });

  it('tryb demo: bez zapisu', async () => {
    db();
    fakeSession.configured = false;
    expect(await setEmailLocaleAction('pl')).toEqual({ ok: true, locale: 'pl', demo: true });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('loadEmailLocale (#1049)', () => {
  it('pokazuje język, który kolejka faktycznie zastosuje (preferowany → konto → rejestracja → en)', async () => {
    const row = (r: Record<string, string | null>) => () => [r];
    db({ row: row({ preferred_locale: 'nl', account_locale: 'pl', signup_locale: 'fr' }) });
    expect(await loadEmailLocale('pl')).toEqual({ status: 'ready', locale: 'nl', demo: false });
    db({ row: row({ preferred_locale: null, account_locale: 'fr', signup_locale: 'pl' }) });
    expect(await loadEmailLocale('pl')).toMatchObject({ locale: 'fr' });
    db({ row: row({ preferred_locale: null, account_locale: null, signup_locale: 'pl' }) });
    expect(await loadEmailLocale('en')).toMatchObject({ locale: 'pl' });
    // Kontrola ujemna: język bieżącej strony NIE wpływa na wynik (nie jest językiem nadawcy/sesji).
    db({ row: row({ preferred_locale: null, account_locale: null, signup_locale: null }) });
    expect(await loadEmailLocale('nl')).toMatchObject({ locale: 'en' });
    expect(fakeDb.callsTo('email-locale.own')[0]!.values).toEqual([USER]);
  });

  it('błąd odczytu, brak wiersza i brak sesji = error (bez udawania wartości domyślnej)', async () => {
    db({ row: () => { throw pgError('XX000', 'boom'); } });
    expect(await loadEmailLocale('pl')).toEqual({ status: 'error' });
    db({ row: () => [] });
    expect(await loadEmailLocale('pl')).toEqual({ status: 'error' });
    db({ user: null });
    expect(await loadEmailLocale('pl')).toEqual({ status: 'error' });
  });

  it('demo: język bieżącej strony', async () => {
    db();
    fakeSession.configured = false;
    expect(await loadEmailLocale('fr')).toEqual({ status: 'ready', locale: 'fr', demo: true });
  });
});

function renderForm(initial: 'pl' | 'nl' | 'fr' | 'en' = 'pl') {
  return render(
    <NextIntlClientProvider locale="pl" messages={pl}>
      <EmailLocaleSettings initial={initial} />
    </NextIntlClientProvider>,
  );
}

describe('EmailLocaleSettings (#1049)', () => {
  it('pokazuje bieżący język, zapis zablokowany bez zmiany, potem zapis i komunikat', async () => {
    const action = vi.fn().mockResolvedValue({ ok: true, locale: 'nl' });
    vi.spyOn(await import('@/lib/actions/email-locale'), 'setEmailLocaleAction').mockImplementation(action);
    renderForm('pl');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe('pl');
    const button = screen.getByRole('button', { name: pl.settings.emailLocaleSave });
    expect(button).toBeDisabled();
    fireEvent.change(select, { target: { value: 'nl' } });
    expect(button).toBeEnabled();
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(pl.settings.emailLocaleSaved));
    expect(action).toHaveBeenCalledWith('nl');
    expect(button).toBeDisabled();
  });

  it('błąd zapisu: komunikat z kodu, wybór zostaje (Invariant #8, #11)', async () => {
    vi.spyOn(await import('@/lib/actions/email-locale'), 'setEmailLocaleAction')
      .mockResolvedValue({ ok: false, error: 'INTERNAL' });
    renderForm('pl');
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'fr' } });
    fireEvent.click(screen.getByRole('button', { name: pl.settings.emailLocaleSave }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByRole('alert').textContent).not.toMatch(/INTERNAL|relation|stack/i);
    expect(select.value).toBe('fr');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('teksty sekcji (PL/NL/FR/EN)', () => {
  it.each([['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const)('%s: komplet kluczy', (_l, m) => {
    for (const key of ['emailLocaleTitle', 'emailLocaleDescription', 'emailLocaleLabel', 'emailLocaleSave',
      'emailLocaleSaving', 'emailLocaleSaved', 'emailLocaleLoadError'] as const) {
      expect(m.settings[key].length).toBeGreaterThan(5);
    }
    expect(m.admin.auditActionEmailLocaleChanged.length).toBeGreaterThan(5);
    expect(m.admin.entityProfile.length).toBeGreaterThan(2);
  });
});
