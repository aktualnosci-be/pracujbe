import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { alertOffHeadersFor, alertOffLinkFor, unsubscribeLinksFor } from '@/lib/email/outbox';

/**
 * #856 — retry tego samego wiersza kolejki musi wysłać dostawcy IDENTYCZNY payload (Resend
 * odrzuca ponowienie z tym samym `Idempotency-Key`, ale inną treścią: `invalid_idempotent_
 * request`). Termin ważności tokenu wypisania/alertu liczony był od `Date.now()` w chwili
 * renderu — dwie próby tego samego wiersza w różnych chwilach dawały różny token (inny link,
 * inny nagłówek `List-Unsubscribe`). Naprawa: termin liczymy od `email_deliveries.created_at`,
 * który jest STAŁY dla danego wiersza niezależnie od liczby prób.
 */

const SECRET = 'x'.repeat(40);
const SITE = 'https://pracuj.be';
const PROFILE = '11111111-1111-1111-1111-111111111111';
const SEARCH_ID = '22222222-2222-2222-2222-222222222222';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('#856 — token wypisania stabilny między próbami tego samego wiersza', () => {
  it('retry po przesunięciu zegara: ten sam link i te same nagłówki List-Unsubscribe', () => {
    const row = { profile_id: PROFILE, template: 'statusChanged', created_at: '2026-01-01T00:00:00.000Z' };

    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    const first = unsubscribeLinksFor(row, 'pl', SITE, SECRET);

    // Retry: dostawca przyjął pierwszą próbę, ale zapis ACK zawiódł — worker próbuje ponownie
    // po odłożeniu wiersza, zegar poszedł naprzód o kilkanaście sekund.
    vi.setSystemTime(new Date('2026-01-01T00:00:23.000Z'));
    const second = unsubscribeLinksFor(row, 'pl', SITE, SECRET);

    expect(first).not.toBeNull();
    expect(second).toEqual(first);
  });

  it('KONTROLA UJEMNA: wiersze z RÓŻNYM created_at (inne wiadomości) dostają różne tokeny', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const rowA = { profile_id: PROFILE, template: 'statusChanged', created_at: '2026-01-01T00:00:00.000Z' };
    const rowB = { profile_id: PROFILE, template: 'statusChanged', created_at: '2026-06-01T00:00:00.000Z' };

    const linkA = unsubscribeLinksFor(rowA, 'pl', SITE, SECRET);
    const linkB = unsubscribeLinksFor(rowB, 'pl', SITE, SECRET);

    expect(linkA).not.toBeNull();
    expect(linkB).not.toBeNull();
    expect(linkA!.pageUrl).not.toBe(linkB!.pageUrl);
  });

  it('brak/zły created_at (atrapa bez tego pola): funkcja nie rzuca, token nadal ważny', () => {
    const row = { profile_id: PROFILE, template: 'statusChanged' };
    const link = unsubscribeLinksFor(row, 'pl', SITE, SECRET);
    expect(link).not.toBeNull();
    expect(link!.pageUrl).toContain('/pl/wypisz#t=');
  });
});

describe('#856 — token wyłączenia alertu (jobMatch) stabilny między próbami', () => {
  const alertRow = {
    profile_id: PROFILE,
    template: 'jobMatch',
    entity_type: 'saved_search',
    entity_id: SEARCH_ID,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  it('retry po przesunięciu zegara: ten sam link „wyłącz alert” i te same nagłówki', () => {
    vi.setSystemTime(new Date('2026-01-01T00:00:05.000Z'));
    const firstLink = alertOffLinkFor(alertRow, 'pl', SITE, SECRET);
    const firstHeaders = alertOffHeadersFor(alertRow, 'pl', SITE, SECRET);

    vi.setSystemTime(new Date('2026-01-01T00:05:00.000Z'));
    const secondLink = alertOffLinkFor(alertRow, 'pl', SITE, SECRET);
    const secondHeaders = alertOffHeadersFor(alertRow, 'pl', SITE, SECRET);

    expect(firstLink).not.toBeNull();
    expect(secondLink).toBe(firstLink);
    expect(secondHeaders).toEqual(firstHeaders);
  });

  it('KONTROLA UJEMNA: inny wiersz (inny created_at) dostaje inny token alertu', () => {
    const other = { ...alertRow, created_at: '2026-06-01T00:00:00.000Z' };
    const linkA = alertOffLinkFor(alertRow, 'pl', SITE, SECRET);
    const linkB = alertOffLinkFor(other, 'pl', SITE, SECRET);
    expect(linkA).not.toBe(linkB);
  });
});
