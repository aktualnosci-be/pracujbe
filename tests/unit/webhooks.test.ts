import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  normalizeWebhookSecret,
  signStandardWebhook,
  verifyStandardWebhook,
  type StandardWebhookHeaders,
} from '@/lib/webhooks';

// Sekret testowy: 'test-secret-key' zakodowany base64 (część po 'whsec_').
const RAW_KEY_B64 = Buffer.from('test-secret-key').toString('base64');
const SECRET_WHSEC = `whsec_${RAW_KEY_B64}`;
const SECRET_V1_WHSEC = `v1,whsec_${RAW_KEY_B64}`;

const ID = 'msg_2abc';
const BODY = JSON.stringify({ user: { email: 'a@b.pl' }, email_data: { token_hash: 'x' } });
const NOW = 1_700_000_000; // stały „teraz" (sekundy) — bez Date.now() w asercjach

/** Buduje nagłówki z poprawnym podpisem dla danego sekretu i znacznika czasu. */
function headersFor(secret: string, ts: number): StandardWebhookHeaders {
  return {
    id: ID,
    timestamp: String(ts),
    signature: signStandardWebhook(secret, ID, String(ts), BODY),
  };
}

describe('normalizeWebhookSecret', () => {
  it('obcina prefiks whsec_', () => {
    expect(normalizeWebhookSecret(SECRET_WHSEC)).toBe(RAW_KEY_B64);
  });

  it('obcina prefiks v1,whsec_ (format podawany przez Supabase)', () => {
    expect(normalizeWebhookSecret(SECRET_V1_WHSEC)).toBe(RAW_KEY_B64);
  });

  it('zostawia goły base64 bez prefiksu', () => {
    expect(normalizeWebhookSecret(RAW_KEY_B64)).toBe(RAW_KEY_B64);
  });
});

describe('verifyStandardWebhook', () => {
  it('akceptuje poprawny podpis (sekret whsec_)', () => {
    const h = headersFor(SECRET_WHSEC, NOW);
    expect(verifyStandardWebhook(SECRET_WHSEC, h, BODY, { nowSeconds: NOW })).toBe(true);
  });

  it('akceptuje poprawny podpis, gdy sekret ma prefiks v1,whsec_ (regresja P2)', () => {
    // Kluczowa regresja: Supabase podaje 'v1,whsec_...'. Podpis liczony tym samym kluczem.
    const h = headersFor(SECRET_V1_WHSEC, NOW);
    expect(verifyStandardWebhook(SECRET_V1_WHSEC, h, BODY, { nowSeconds: NOW })).toBe(true);
  });

  it('podpis z whsec_ i weryfikacja z v1,whsec_ dają ten sam klucz (interop)', () => {
    const h = headersFor(SECRET_WHSEC, NOW);
    expect(verifyStandardWebhook(SECRET_V1_WHSEC, h, BODY, { nowSeconds: NOW })).toBe(true);
  });

  it('odrzuca zmieniony body (podpis nie pasuje)', () => {
    const h = headersFor(SECRET_WHSEC, NOW);
    expect(verifyStandardWebhook(SECRET_WHSEC, h, BODY + 'tamper', { nowSeconds: NOW })).toBe(false);
  });

  it('odrzuca zły sekret', () => {
    const h = headersFor(SECRET_WHSEC, NOW);
    const wrong = `whsec_${Buffer.from('other-key').toString('base64')}`;
    expect(verifyStandardWebhook(wrong, h, BODY, { nowSeconds: NOW })).toBe(false);
  });

  it('odrzuca nieświeży znacznik czasu poza oknem (anty-replay, regresja P3)', () => {
    const stale = NOW - 3600; // godzinę temu
    const h = headersFor(SECRET_WHSEC, stale);
    expect(verifyStandardWebhook(SECRET_WHSEC, h, BODY, { nowSeconds: NOW, toleranceSeconds: 300 })).toBe(false);
  });

  it('akceptuje znacznik czasu w oknie tolerancji', () => {
    const recent = NOW - 120; // 2 min temu, w oknie ±300 s
    const h = headersFor(SECRET_WHSEC, recent);
    expect(verifyStandardWebhook(SECRET_WHSEC, h, BODY, { nowSeconds: NOW, toleranceSeconds: 300 })).toBe(true);
  });

  it('odrzuca nieparsowalny znacznik czasu', () => {
    const h = { ...headersFor(SECRET_WHSEC, NOW), timestamp: 'not-a-number' };
    expect(verifyStandardWebhook(SECRET_WHSEC, h, BODY, { nowSeconds: NOW })).toBe(false);
  });

  it('odrzuca brakujące nagłówki (fail-closed)', () => {
    const base = headersFor(SECRET_WHSEC, NOW);
    expect(verifyStandardWebhook(SECRET_WHSEC, { ...base, id: null }, BODY, { nowSeconds: NOW })).toBe(false);
    expect(verifyStandardWebhook(SECRET_WHSEC, { ...base, timestamp: null }, BODY, { nowSeconds: NOW })).toBe(false);
    expect(verifyStandardWebhook(SECRET_WHSEC, { ...base, signature: null }, BODY, { nowSeconds: NOW })).toBe(false);
  });

  it('obsługuje wiele podpisów w nagłówku (spacja) — pasuje którykolwiek', () => {
    const good = signStandardWebhook(SECRET_WHSEC, ID, String(NOW), BODY);
    const key = Buffer.from(normalizeWebhookSecret(SECRET_WHSEC), 'base64');
    const bogus = `v1,${createHmac('sha256', key).update('nonsense').digest('base64')}`;
    const h: StandardWebhookHeaders = { id: ID, timestamp: String(NOW), signature: `${bogus} ${good}` };
    expect(verifyStandardWebhook(SECRET_WHSEC, h, BODY, { nowSeconds: NOW })).toBe(true);
  });
});
