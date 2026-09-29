// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * CFG29-07 (#1121): globalny limit Server Actions (6 MB, upload CV i załączników) nie może
 * obowiązywać anonimowych formularzy. Middleware odrzuca 413 duże żądanie Server Action poza
 * panelami; panele (uploady) i zwykłe żądania zostają bez zmian.
 */
const intl = vi.hoisted(() => ({ handler: vi.fn() }));
vi.mock('next-intl/middleware', () => ({ default: () => intl.handler }));

import middleware from '@/middleware';
import {
  isOversizedPublicAction,
  isPanelPath,
  PUBLIC_ACTION_MAX_BYTES,
} from '@/lib/http/public-action-body-limit';

const BIG = String(PUBLIC_ACTION_MAX_BYTES + 1);
const SMALL = String(PUBLIC_ACTION_MAX_BYTES);

function post(path: string, headers: Record<string, string>) {
  return new NextRequest(`https://pracuj.example${path}`, { method: 'POST', headers });
}

beforeEach(() => {
  intl.handler.mockReset();
  intl.handler.mockImplementation(() => NextResponse.next());
});

describe('isPanelPath', () => {
  it.each(['/pl/candidate/profil', '/nl/employer', '/fr/admin/firmy', '/candidate/profil'])('%s = panel', (path) => {
    expect(isPanelPath(path)).toBe(true);
  });
  it.each(['/pl/kontakt', '/en/oferty-pracy/magazynier-1', '/pl', '/', '/pl/zglos-tresc', '/pl/pracodawcy/candidate'])(
    '%s = publiczna',
    (path) => {
      expect(isPanelPath(path)).toBe(false);
    },
  );
});

describe('middleware: limit Server Actions na stronach publicznych', () => {
  it.each(['/pl/kontakt', '/nl/oferty-pracy/magazynier-1', '/fr/zglos-tresc', '/en/logowanie'])(
    '%s: Server Action ponad próg → 413 bez next-intl',
    async (path) => {
      const res = await middleware(post(path, { 'next-action': 'abc', 'content-length': BIG }));
      expect(res.status).toBe(413);
      expect(res.headers.get('cache-control')).toBe('private, no-store');
      expect(intl.handler).not.toHaveBeenCalled();
    },
  );

  it('kontrola ujemna: próg włącznie, panele (uploady), zwykłe POST/GET i brak długości przechodzą', async () => {
    const pass = async (path: string, headers: Record<string, string>, method = 'POST') => {
      intl.handler.mockClear();
      const res = await middleware(new NextRequest(`https://pracuj.example${path}`, { method, headers }));
      expect(res.status).not.toBe(413);
      expect(intl.handler).toHaveBeenCalledTimes(1);
    };
    await pass('/pl/kontakt', { 'next-action': 'abc', 'content-length': SMALL });
    await pass('/pl/candidate/profil', { 'next-action': 'abc', 'content-length': BIG });
    await pass('/pl/employer/wiadomosci', { 'next-action': 'abc', 'content-length': BIG });
    await pass('/pl/kontakt', { 'content-length': BIG }); // bez nagłówka next-action
    await pass('/pl/kontakt', { 'next-action': 'abc' }); // bez Content-Length: decyduje limit Next
    await pass('/pl/kontakt', { 'next-action': 'abc', 'content-length': 'x' });
  });

  it('funkcja czysta: tylko POST z next-action', () => {
    const headers = new Headers({ 'next-action': 'a', 'content-length': BIG });
    expect(isOversizedPublicAction('/pl/kontakt', 'POST', headers)).toBe(true);
    expect(isOversizedPublicAction('/pl/kontakt', 'GET', headers)).toBe(false);
  });
});
