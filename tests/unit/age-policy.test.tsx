import * as React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANDIDATE_ADULT_AGE,
  CANDIDATE_MIN_AGE_FALLBACK,
  CANDIDATE_MIN_AGE_HIGHEST,
  CANDIDATE_MIN_AGE_LOWEST,
  candidateAgeBandsFor,
  isAgeAdultRequiredError,
  isAgeAttestationError,
  minAgeSchema,
  normalizeCandidateMinAge,
} from '@/lib/age-policy';
import { attestCandidateAgeAction } from '@/lib/actions/age-attestation';
import { loadMyAgeAttestation } from '@/lib/data/age-policy';
import { AgeAttestationSettings } from '@/components/settings/AgeAttestationSettings';
import { FUNNEL_MINOR_STORAGE_KEY, isKnownMinorDevice, sendFunnelEvent } from '@/lib/job-funnel/client';
import type { PortalIdentity } from '@/lib/auth/session';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';
import { fakeDb, fakeSession, pgError, resetFakeDb } from '../helpers/fake-db';

/**
 * Polityka wieku kandydatów (#492, #576): próg konta jako dane (0126, 16 albo 18),
 * potwierdzenie przedziału 16–17 / 18+ bez daty urodzenia, akcja deklaracji w ustawieniach,
 * sekcja „Wiek” i lejek ofert wyłączony dla konta 16–17. Egzekwowanie w bazie: rls.sql AGE492.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ isDatabaseConfigured: vi.fn(() => false) }));
vi.mock('@/lib/db/portal', async () => (await import('../helpers/fake-db')).fakePortal());
vi.mock('@/lib/error-report', () => ({ captureError: vi.fn() }));
vi.mock('@/lib/actions/age-attestation', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/actions/age-attestation')>();
  return { ...actual, attestCandidateAgeAction: vi.fn(actual.attestCandidateAgeAction) };
});

// Radix Checkbox mierzy rozmiar przez ResizeObserver (brak w jsdom).
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const MIGRATION = (() => {
  const dir = resolve(process.cwd(), 'supabase/migrations');
  const name = readdirSync(dir).find((file) => file.endsWith('_candidate_age_policy.sql'));
  if (!name) throw new Error('Brak migracji polityki wieku');
  return readFileSync(resolve(dir, name), 'utf8');
})();

const USER = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

/** Baza pod sesją kandydata: RPC `fn` zwraca `data` albo rzuca błąd PostgreSQL. */
function dbRpc(fn: string, result: { data: unknown } | { fail: string }) {
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
  fakeDb.rpc(fn, () => {
    if ('fail' in result) throw pgError('P0001', result.fail);
    return result.data;
  });
}

beforeEach(() => {
  resetFakeDb({ id: USER, role: 'candidate' } as PortalIdentity);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe('próg wieku — granice i wartość awaryjna', () => {
  it('próg konta i przedziały są takie same jak w migracji (decyzja #576: konto od 16)', () => {
    expect(CANDIDATE_MIN_AGE_LOWEST).toBe(16);
    expect(CANDIDATE_MIN_AGE_HIGHEST).toBe(18);
    expect(CANDIDATE_ADULT_AGE).toBe(18);
    expect(MIGRATION).toMatch(
      /candidate_min_age smallint not null default 16 check \(candidate_min_age in \(16, 18\)\)/,
    );
    expect(MIGRATION).toMatch(/values \(true, 16, true,/);
    // Wartość awaryjna = 18: przy błędzie odczytu formularz pokazuje tylko przedział 18+.
    expect(CANDIDATE_MIN_AGE_FALLBACK).toBe(CANDIDATE_MIN_AGE_HIGHEST);
  });

  it('migracja nie zbiera daty ani roku urodzenia — tylko przedział 16 / 18', () => {
    expect(MIGRATION).not.toMatch(/birth|date_of_birth|birth_year|urodzenia\s+(date|smallint|integer)/i);
    expect(MIGRATION).toMatch(/min_age\s+smallint not null check \(min_age in \(16, 18\)\)/);
  });

  it('widoczność profilu dla firm tylko 18+ — trigger z AGE_ADULT_REQUIRED w migracji', () => {
    expect(MIGRATION).toMatch(/if not public\.candidate_is_adult\(new\.profile_id\) then\s+raise exception 'AGE_ADULT_REQUIRED/);
  });

  it.each([
    [16, 16],
    ['18', 18],
    [17, CANDIDATE_MIN_AGE_FALLBACK],
    [15, CANDIDATE_MIN_AGE_FALLBACK],
    [19, CANDIDATE_MIN_AGE_FALLBACK],
    [null, CANDIDATE_MIN_AGE_FALLBACK],
    ['abc', CANDIDATE_MIN_AGE_FALLBACK],
    [16.5, CANDIDATE_MIN_AGE_FALLBACK],
  ])('normalizeCandidateMinAge(%j) = %i', (value, expected) => {
    expect(normalizeCandidateMinAge(value)).toBe(expected);
  });

  it.each([
    [16, [16, 18]],
    [18, [18]],
    [13, [18]],
  ])('przedziały do wyboru przy progu %i = %j', (threshold, bands) => {
    expect(candidateAgeBandsFor(threshold)).toEqual(bands);
  });

  it('schemat przyjmuje tylko przedziały 16 i 18 (klucz tłumaczenia przy błędzie)', () => {
    expect(minAgeSchema.safeParse(16).success).toBe(true);
    expect(minAgeSchema.safeParse(18).success).toBe(true);
    for (const value of [15, 17, 19, 13, null, '18']) {
      const parsed = minAgeSchema.safeParse(value);
      expect(parsed.success).toBe(false);
      expect(!parsed.success && parsed.error.issues[0]?.message).toBe('errors.ageAttestationRequired');
    }
  });

  it('rozpoznaje komunikaty bazy o braku deklaracji i o wymogu pełnoletności', () => {
    expect(isAgeAttestationError('AGE_ATTESTATION_REQUIRED')).toBe(true);
    expect(isAgeAttestationError('PERMISSION_DENIED')).toBe(false);
    expect(isAgeAttestationError(undefined)).toBe(false);
    expect(isAgeAdultRequiredError('AGE_ADULT_REQUIRED: wyszukiwalność')).toBe(true);
    expect(isAgeAdultRequiredError('AGE_ATTESTATION_REQUIRED')).toBe(false);
  });
});

describe('attestCandidateAgeAction', () => {
  it('wysyła tylko próg (bez daty urodzenia) i zwraca stan z bazy', async () => {
    dbRpc('attest_candidate_age', { data: true });
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({ ok: true, meetsPolicy: true });
    expect(fakeDb.callsTo('attest_candidate_age')[0]).toMatchObject({ args: { p_min_age: 18 }, as: USER });
  });

  it.each([
    [{ confirmed: false, minAge: 18 }],
    [{ confirmed: true }],
    [{ confirmed: true, minAge: 12 }],
    [{ confirmed: true, minAge: 17 }],
    [null],
  ])(
    'odrzuca %j bez wywołania bazy',
    async (input) => {
      dbRpc('attest_candidate_age', { data: true });
      expect(await attestCandidateAgeAction(input)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(fakeDb.calls).toHaveLength(0);
    },
  );

  it.each([
    ['AGE_ATTESTATION_REQUIRED', 'AGE_ATTESTATION_REQUIRED'],
    ['PERMISSION_DENIED: deklaracja wieku tylko dla kandydata', 'PERMISSION_DENIED'],
    ['relation "x" does not exist', 'INTERNAL'],
  ])('mapuje błąd bazy %s → %s (bez technikaliów)', async (message, code) => {
    dbRpc('attest_candidate_age', { fail: message });
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({ ok: false, error: code });
  });

  it('bez sesji → PERMISSION_DENIED, bez zapytania do bazy', async () => {
    resetFakeDb(null);
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({
      ok: false,
      error: 'PERMISSION_DENIED',
    });
    expect(fakeDb.calls).toHaveLength(0);
  });

  it('tryb demo niczego nie zapisuje', async () => {
    fakeSession.configured = false;
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({
      ok: true,
      meetsPolicy: true,
      demo: true,
    });
    expect(fakeDb.calls).toHaveLength(0);
  });
});

describe('loadMyAgeAttestation', () => {
  it('czyta stan pod sesją; brak deklaracji = attestedMinAge null', async () => {
    dbRpc('get_my_age_attestation', {
      data: { required_min_age: 16, attested_min_age: null, meets_policy: false, is_adult: false },
    });
    expect(await loadMyAgeAttestation()).toEqual({
      status: 'ready',
      demo: false,
      requiredMinAge: 16,
      attestedMinAge: null,
      meetsPolicy: false,
      isAdult: false,
    });
  });

  it('konto 16–17: spełnia próg konta, nie jest pełnoletnie (isAdult z bazy)', async () => {
    dbRpc('get_my_age_attestation', {
      data: { required_min_age: 16, attested_min_age: 16, meets_policy: true, is_adult: false },
    });
    expect(await loadMyAgeAttestation()).toMatchObject({ meetsPolicy: true, isAdult: false, attestedMinAge: 16 });
  });

  it('błąd odczytu → jawny błąd, nie „spełnione”', async () => {
    dbRpc('get_my_age_attestation', { fail: 'boom' });
    expect(await loadMyAgeAttestation()).toEqual({ status: 'error' });
  });
});

describe('AgeAttestationSettings', () => {
  type State = { requiredMinAge: number; attestedMinAge: number | null; meetsPolicy: boolean; isAdult: boolean };
  const MISSING: State = { requiredMinAge: 16, attestedMinAge: null, meetsPolicy: false, isAdult: false };
  const MINOR: State = { requiredMinAge: 16, attestedMinAge: 16, meetsPolicy: true, isAdult: false };

  function bandName(messages: typeof pl, band: number): string {
    return band < 18
      ? messages.auth.ageBandMinor.replace('{min}', String(band)).replace('{max}', '17')
      : messages.auth.ageBandAdult.replace('{age}', '18');
  }

  function renderSettings(initial: State = MISSING, messages = pl, locale = 'pl') {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AgeAttestationSettings initial={initial} />
      </NextIntlClientProvider>,
    );
    return {
      radio: (band: number) => screen.getByRole('radio', { name: bandName(messages, band) }),
      submit: screen.getByRole('button', { name: messages.ageAttestation.submit }),
    };
  }

  it('bez wyboru przedziału: błąd przy polu i fokus, bez zapisu', () => {
    const f = renderSettings();
    fireEvent.click(f.submit);
    expect(attestCandidateAgeAction).not.toHaveBeenCalled();
    expect(screen.getByRole('radiogroup', { name: pl.auth.ageBandLegend })).toHaveAttribute('aria-invalid', 'true');
    expect(f.radio(16)).toHaveAccessibleDescription(new RegExp(pl.auth.error.ageConfirmRequired));
    expect(document.activeElement).toBe(f.radio(16));
  });

  it('18+: po zapisie stan pełnoletni z serwera (en), lejek bez znacznika', async () => {
    dbRpc('attest_candidate_age', { data: true });
    const f = renderSettings(MISSING, en, 'en');
    fireEvent.click(f.radio(18));
    fireEvent.click(f.submit);
    expect(await screen.findByRole('status')).toHaveTextContent(en.ageAttestation.saved);
    expect(screen.getByTestId('age-attestation-state')).toHaveTextContent(
      en.ageAttestation.stateAdult.replace('{age}', '18'),
    );
    expect(attestCandidateAgeAction).toHaveBeenCalledWith({ confirmed: true, minAge: 18 });
    expect(isKnownMinorDevice()).toBe(false);
  });

  it('16–17: wyjaśnienie przy wyborze, zapis przedziału 16, stan „mniej niż 18”, lejek wyłączony', async () => {
    dbRpc('attest_candidate_age', { data: true });
    const f = renderSettings();
    fireEvent.click(f.radio(16));
    expect(f.radio(16)).toHaveAccessibleDescription(new RegExp(pl.auth.ageBandMinorHint.slice(0, 40)));
    fireEvent.click(f.submit);
    expect(await screen.findByRole('status')).toHaveTextContent(pl.ageAttestation.saved);
    expect(attestCandidateAgeAction).toHaveBeenCalledWith({ confirmed: true, minAge: 16 });
    expect(screen.getByTestId('age-attestation-state')).toHaveTextContent(
      pl.ageAttestation.stateMinor.split('{adultAge}')[0]!,
    );
    expect(window.localStorage.getItem(FUNNEL_MINOR_STORAGE_KEY)).toBe('1');
  });

  it('konto 16–17: tylko przejście na 18+ (bez ponownego wyboru 16–17)', () => {
    const f = renderSettings(MINOR);
    expect(f.radio(18)).toBeInTheDocument();
    expect(screen.queryByRole('radio', { name: bandName(pl, 16) })).toBeNull();
  });

  it('odmowa bazy (próg zmieniony): komunikat błędu, stan bez zmian', async () => {
    dbRpc('attest_candidate_age', { fail: 'AGE_ATTESTATION_REQUIRED' });
    const f = renderSettings();
    fireEvent.click(f.radio(16));
    fireEvent.click(f.submit);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(pl.ageAttestation.saveError));
    expect(screen.getByTestId('age-attestation-state')).toHaveTextContent(pl.ageAttestation.stateMissing);
  });
});

describe('lejek ofert dla konta 16–17 (#576, LAUNCH-1: jak brak zgody)', () => {
  it('urządzenie znanej osoby 16–17: żadnego żądania do /api/job-funnel', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    window.localStorage.setItem(FUNNEL_MINOR_STORAGE_KEY, '1');
    sendFunnelEvent('detail_view', ['00000000-0000-4000-8000-000000000001'], 'nonce-1');
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it('kontrola ujemna: bez znacznika zdarzenie jest wysyłane', () => {
    const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 204 })));
    vi.stubGlobal('fetch', fetchMock);
    sendFunnelEvent('detail_view', ['00000000-0000-4000-8000-000000000001'], 'nonce-2');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it('storage niedostępny → pomiar pomijany (bezpieczniej nie wysłać)', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(isKnownMinorDevice()).toBe(true);
    getItem.mockRestore();
  });
});
