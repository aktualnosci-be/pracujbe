import * as React from 'react';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CANDIDATE_MIN_AGE_FALLBACK,
  CANDIDATE_MIN_AGE_HIGHEST,
  CANDIDATE_MIN_AGE_LOWEST,
  isAgeAttestationError,
  minAgeSchema,
  normalizeCandidateMinAge,
} from '@/lib/age-policy';
import { attestCandidateAgeAction } from '@/lib/actions/age-attestation';
import { loadMyAgeAttestation } from '@/lib/data/age-policy';
import { AgeAttestationSettings } from '@/components/settings/AgeAttestationSettings';
import { isSupabaseConfigured } from '@/lib/env';
import { createServerClient } from '@/lib/supabase/server';
import pl from '@/messages/pl.json';
import en from '@/messages/en.json';

/**
 * Polityka wieku kandydatów (#492): próg jako dane (0110), deklaracja bez daty urodzenia,
 * akcja deklaracji w ustawieniach i sekcja „Wiek”. Egzekwowanie w bazie: rls.sql AGE492.
 */

vi.mock('server-only', () => ({}));
vi.mock('@/lib/env', () => ({ isSupabaseConfigured: vi.fn(), isDatabaseConfigured: vi.fn(() => false) }));
vi.mock('@/lib/supabase/server', () => ({ createServerClient: vi.fn() }));
vi.mock('@/lib/sentry', () => ({ captureError: vi.fn() }));
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

function rpcClient(result: { data: unknown; error: unknown }) {
  const client = { rpc: vi.fn(async () => result) };
  vi.mocked(createServerClient).mockResolvedValue(client as never);
  return client;
}

beforeEach(() => {
  vi.mocked(isSupabaseConfigured).mockReturnValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('próg wieku — granice i wartość awaryjna', () => {
  it('zakres i wartość domyślna są takie same jak w migracji (dane, nie stała w kodzie)', () => {
    expect(MIGRATION).toMatch(
      new RegExp(`candidate_min_age smallint not null default 18 check \\(candidate_min_age between ${CANDIDATE_MIN_AGE_LOWEST} and ${CANDIDATE_MIN_AGE_HIGHEST}\\)`),
    );
    expect(MIGRATION).toMatch(/values \(true, 18, false\)/);
    // Wartość awaryjna = górna granica: deklaracja „co najmniej 18” spełnia każdy próg.
    expect(CANDIDATE_MIN_AGE_FALLBACK).toBe(CANDIDATE_MIN_AGE_HIGHEST);
  });

  it('migracja nie zbiera daty ani roku urodzenia', () => {
    expect(MIGRATION).not.toMatch(/birth|date_of_birth|birth_year|urodzenia\s+(date|smallint|integer)/i);
    expect(MIGRATION).toMatch(/min_age\s+smallint not null check \(min_age between 13 and 18\)/);
  });

  it.each([
    [16, 16],
    ['17', 17],
    [12, CANDIDATE_MIN_AGE_FALLBACK],
    [19, CANDIDATE_MIN_AGE_FALLBACK],
    [null, CANDIDATE_MIN_AGE_FALLBACK],
    ['abc', CANDIDATE_MIN_AGE_FALLBACK],
    [16.5, CANDIDATE_MIN_AGE_FALLBACK],
  ])('normalizeCandidateMinAge(%j) = %i', (value, expected) => {
    expect(normalizeCandidateMinAge(value)).toBe(expected);
  });

  it('schemat progu odrzuca wartości spoza 13–18 kluczem tłumaczenia', () => {
    expect(minAgeSchema.safeParse(13).success).toBe(true);
    expect(minAgeSchema.safeParse(18).success).toBe(true);
    const low = minAgeSchema.safeParse(12);
    expect(low.success).toBe(false);
    expect(!low.success && low.error.issues[0]?.message).toBe('errors.ageAttestationRequired');
    expect(minAgeSchema.safeParse(19).success).toBe(false);
  });

  it('rozpoznaje komunikat bazy o braku deklaracji', () => {
    expect(isAgeAttestationError('AGE_ATTESTATION_REQUIRED')).toBe(true);
    expect(isAgeAttestationError('PERMISSION_DENIED')).toBe(false);
    expect(isAgeAttestationError(undefined)).toBe(false);
  });
});

describe('attestCandidateAgeAction', () => {
  it('wysyła tylko próg (bez daty urodzenia) i zwraca stan z bazy', async () => {
    const client = rpcClient({ data: true, error: null });
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({ ok: true, meetsPolicy: true });
    expect(client.rpc).toHaveBeenCalledWith('attest_candidate_age', { p_min_age: 18 });
  });

  it.each([[{ confirmed: false, minAge: 18 }], [{ confirmed: true }], [{ confirmed: true, minAge: 12 }], [null]])(
    'odrzuca %j bez wywołania bazy',
    async (input) => {
      const client = rpcClient({ data: true, error: null });
      expect(await attestCandidateAgeAction(input)).toEqual({ ok: false, error: 'VALIDATION_FAILED' });
      expect(client.rpc).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['AGE_ATTESTATION_REQUIRED', 'AGE_ATTESTATION_REQUIRED'],
    ['PERMISSION_DENIED: deklaracja wieku tylko dla kandydata', 'PERMISSION_DENIED'],
    ['relation "x" does not exist', 'INTERNAL'],
  ])('mapuje błąd bazy %s → %s (bez technikaliów)', async (message, code) => {
    rpcClient({ data: null, error: { message } });
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({ ok: false, error: code });
  });

  it('tryb demo niczego nie zapisuje', async () => {
    vi.mocked(isSupabaseConfigured).mockReturnValue(false);
    expect(await attestCandidateAgeAction({ confirmed: true, minAge: 18 })).toEqual({
      ok: true,
      meetsPolicy: true,
      demo: true,
    });
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe('loadMyAgeAttestation', () => {
  it('czyta stan pod sesją; brak deklaracji = attestedMinAge null', async () => {
    rpcClient({ data: [{ required_min_age: 18, attested_min_age: null, meets_policy: false }], error: null });
    expect(await loadMyAgeAttestation()).toEqual({
      status: 'ready',
      demo: false,
      requiredMinAge: 18,
      attestedMinAge: null,
      meetsPolicy: false,
    });
  });

  it('błąd odczytu → jawny błąd, nie „spełnione”', async () => {
    rpcClient({ data: null, error: { message: 'boom' } });
    expect(await loadMyAgeAttestation()).toEqual({ status: 'error' });
  });
});

describe('AgeAttestationSettings', () => {
  function renderSettings(messages = pl, locale = 'pl') {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <AgeAttestationSettings initial={{ requiredMinAge: 18, attestedMinAge: null, meetsPolicy: false }} />
      </NextIntlClientProvider>,
    );
    return {
      checkbox: screen.getByRole('checkbox', { name: messages.auth.ageConfirm.replace('{age}', '18') }),
      submit: screen.getByRole('button', { name: messages.ageAttestation.submit }),
    };
  }

  it('bez zaznaczenia: błąd przy polu i fokus, bez zapisu', () => {
    const f = renderSettings();
    fireEvent.click(f.submit);
    expect(attestCandidateAgeAction).not.toHaveBeenCalled();
    expect(f.checkbox).toHaveAttribute('aria-invalid', 'true');
    expect(f.checkbox).toHaveAccessibleDescription(new RegExp(pl.auth.error.ageConfirmRequired));
    expect(document.activeElement).toBe(f.checkbox);
  });

  it('po zapisie pokazuje stan potwierdzony z serwera (en)', async () => {
    rpcClient({ data: true, error: null });
    const f = renderSettings(en, 'en');
    fireEvent.click(f.checkbox);
    fireEvent.click(f.submit);
    expect(await screen.findByRole('status')).toHaveTextContent(en.ageAttestation.saved);
    expect(screen.getByTestId('age-attestation-state')).toHaveTextContent(
      en.ageAttestation.stateOk.replace('{age}', '18'),
    );
    expect(attestCandidateAgeAction).toHaveBeenCalledWith({ confirmed: true, minAge: 18 });
  });

  it('odmowa bazy (próg zmieniony): komunikat błędu, stan bez zmian', async () => {
    rpcClient({ data: null, error: { message: 'AGE_ATTESTATION_REQUIRED' } });
    const f = renderSettings();
    fireEvent.click(f.checkbox);
    fireEvent.click(f.submit);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(pl.ageAttestation.saveError));
    expect(screen.getByTestId('age-attestation-state')).toHaveTextContent(pl.ageAttestation.stateMissing);
  });
});
