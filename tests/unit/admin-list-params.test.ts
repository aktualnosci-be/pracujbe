import { describe, expect, it } from 'vitest';

import {
  cursorOrFilter,
  decodeAdminCursor,
  encodeAdminCursor,
  normalizeAdminSearch,
  parseReportFilter,
  parseUserRoleFilter,
  REPORT_REASON_KEY,
  reportReasonView,
  reportStatusesFor,
  searchOrFilter,
} from '@/lib/admin/list-params';
import { appDayStartUtc, createAppDateFormatter } from '@/lib/datetime';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

const MESSAGES = { pl, nl, fr, en } as const;

describe('kursor list admina (#418)', () => {
  it('round-trip zachowuje dokładny znacznik czasu i id', () => {
    const cursor = {
      createdAt: '2026-03-29T01:30:00.123456+00:00',
      id: '00000000-0000-4000-8000-000000000001',
    };
    const token = encodeAdminCursor(cursor);
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/); // bez `+`, który w URL staje się spacją
    expect(decodeAdminCursor(token)).toEqual(cursor);
  });

  it.each([
    ['pusty', ''],
    ['nie-base64url', 'abc$%'],
    ['zły uuid', Buffer.from('2026-01-01T00:00:00Z|nope').toString('base64url')],
    ['wstrzyknięcie filtra', Buffer.from('2026-01-01T00:00:00Z),id.gt.0|00000000-0000-4000-8000-000000000001').toString('base64url')],
  ])('kontrola ujemna: %s → null (pierwsza strona)', (_name, token) => {
    expect(decodeAdminCursor(token)).toBeNull();
  });

  it('filtr kursora rozstrzyga równe daty po id', () => {
    expect(cursorOrFilter({ createdAt: '2026-01-01T00:00:00Z', id: 'x' })).toBe(
      'created_at.lt."2026-01-01T00:00:00Z",and(created_at.eq."2026-01-01T00:00:00Z",id.lt.x)',
    );
  });
});

describe('wyszukiwanie admina (#418)', () => {
  it('usuwa znaki składni PostgREST i symbole wieloznaczne, skraca do 100', () => {
    expect(normalizeAdminSearch('  a,b(c)"d\\e%f*g  ')).toBe('a b c d e f g');
    expect(normalizeAdminSearch('x'.repeat(150))).toHaveLength(100);
    expect(normalizeAdminSearch('   ')).toBeNull();
    expect(normalizeAdminSearch(undefined)).toBeNull();
    expect(normalizeAdminSearch('jan_kowalski@example.com')).toBe('jan_kowalski@example.com');
  });

  it('buduje warunek ILIKE w cudzysłowie dla każdej kolumny', () => {
    expect(searchOrFilter(['name', 'email'], 'de vos')).toBe(
      'name.ilike."%de vos%",email.ilike."%de vos%"',
    );
  });
});

describe('filtry list admina', () => {
  it('zgłoszenia: domyślnie otwarte + w analizie; nieznana wartość → domyślny', () => {
    expect(parseReportFilter(undefined)).toBe('active');
    expect(parseReportFilter('hacked')).toBe('active');
    expect(reportStatusesFor('active')).toEqual(['open', 'reviewing']);
    expect(reportStatusesFor('resolved')).toEqual(['resolved']);
    expect(reportStatusesFor('all')).toBeNull();
  });

  it('role: tylko role nadawane przez aplikację (bez moderator)', () => {
    expect(parseUserRoleFilter('employer')).toBe('employer');
    expect(parseUserRoleFilter('moderator')).toBeNull();
    expect(parseUserRoleFilter('')).toBeNull();
  });
});

describe('powód zgłoszenia jako etykieta (#416, Invariant #2)', () => {
  it.each(Object.keys(MESSAGES))('%s: każdy kod ma tłumaczenie i nie jest surowym kodem', (locale) => {
    const admin = MESSAGES[locale as keyof typeof MESSAGES].admin as Record<string, string>;
    for (const [code, key] of Object.entries(REPORT_REASON_KEY)) {
      expect(admin[key], `${locale}.${key}`).toBeTruthy();
      // Etykieta, nie surowy kod (`snake_case`/małe litery) — np. „Spam”, nie „spam”.
      expect(admin[key]).not.toBe(code);
    }
    expect(admin.reasonOther).toBeTruthy();
  });

  it('nieznany kod techniczny → neutralne „Inny powód” bez surowej wartości', () => {
    expect(reportReasonView('fake_listing')).toEqual({ key: 'reasonOther', freeText: null });
    expect(reportReasonView('HARASSMENT')).toEqual({ key: 'reasonHarassment', freeText: null });
  });

  it('tekst swobodny zgłaszającego zostaje pokazany jako jego słowa', () => {
    expect(reportReasonView('Podejrzane wynagrodzenie')).toEqual({
      key: 'reasonOther',
      freeText: 'Podejrzane wynagrodzenie',
    });
  });
});

describe('daty panelu w strefie Europe/Brussels (#421)', () => {
  it('serwer w UTC: 12:00Z w lutym (CET) → 13:00', () => {
    const prev = process.env.TZ;
    process.env.TZ = 'UTC';
    try {
      const fmt = createAppDateFormatter('en-GB', { withTime: true });
      expect(fmt('2025-02-19T12:00:00Z')).toBe('19 Feb 2025, 13:00');
      // Czas letni (CEST, +2): 12:00Z → 14:00.
      expect(fmt('2025-07-01T12:00:00Z')).toBe('1 Jul 2025, 14:00');
      // Przejście na czas letni 2025-03-30 01:00Z: tuż przed = 01:59 CET, tuż po = 03:00 CEST.
      expect(fmt('2025-03-30T00:59:00Z')).toBe('30 Mar 2025, 01:59');
      expect(fmt('2025-03-30T01:00:00Z')).toBe('30 Mar 2025, 03:00');
    } finally {
      process.env.TZ = prev;
    }
  });

  it('sama data blisko północy nie przeskakuje o dzień', () => {
    const fmt = createAppDateFormatter('en-GB');
    // 23:30Z 31 grudnia = 00:30 1 stycznia w Brukseli.
    expect(fmt('2025-12-31T23:30:00Z')).toBe('1 Jan 2026');
  });

  it('brak lub zła wartość → fallback', () => {
    const fmt = createAppDateFormatter('pl');
    expect(fmt(null)).toBe('—');
    expect(fmt('not-a-date')).toBe('—');
  });
});

describe('granice dnia w Europe/Brussels (#417)', () => {
  it('zima (CET) i lato (CEST)', () => {
    expect(appDayStartUtc('2025-02-19')).toBe('2025-02-18T23:00:00.000Z');
    expect(appDayStartUtc('2025-07-01')).toBe('2025-06-30T22:00:00.000Z');
    expect(appDayStartUtc('2025-07-01', true)).toBe('2025-07-01T22:00:00.000Z');
    // Dzień zmiany czasu: początek 30 marca to jeszcze CET, koniec to już CEST.
    expect(appDayStartUtc('2025-03-30')).toBe('2025-03-29T23:00:00.000Z');
    expect(appDayStartUtc('2025-03-30', true)).toBe('2025-03-30T22:00:00.000Z');
  });

  it('kontrola ujemna: zła data → null', () => {
    expect(appDayStartUtc('2025-02-30')).toBeNull();
    expect(appDayStartUtc('2025-2-1')).toBeNull();
    expect(appDayStartUtc("2025-01-01' or 1=1")).toBeNull();
    expect(appDayStartUtc(undefined)).toBeNull();
  });
});
