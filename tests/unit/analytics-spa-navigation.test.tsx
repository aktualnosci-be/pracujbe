/* eslint-disable @next/next/no-html-link-for-pages -- test sprawdza klik w zwykłe <a> (Next Link renderuje ten sam element), bez routera */
import { cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { cfBeaconConfig, needsHardNavigation, sameOriginTarget } from '@/lib/analytics/beacon';

/**
 * #1046 (Invariant #7): beacon Cloudflare po zgodzie nie może mierzyć nawigacji klienckich
 * (SPA) na trasy prywatne. `spa: false` + pełne przeładowanie przy przejściu publiczna → prywatna.
 */

let pathname = '/pl';
vi.mock('next/navigation', () => ({ usePathname: () => pathname }));
vi.mock('next/script', () => ({
  default: (props: Record<string, string>) => (
    <script data-testid="beacon" data-cf-beacon={props['data-cf-beacon']} />
  ),
}));
vi.mock('@/lib/consent', () => ({
  getConsent: () => ({ v: '2.0', categories: { necessary: true, preferences: true, analytics: granted }, ts: '', id: 'x' }),
  pendingConsentPersistence: () => Promise.resolve(),
}));
vi.mock('@/lib/consent-store', () => ({ subscribeConsent: () => () => undefined }));

let granted = true;
const DOC_ORIGIN = new URL(document.URL).origin;
const assign = vi.fn();
const reload = vi.fn();

async function loadAnalytics() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN', 'tok-1046');
  return (await import('@/components/cookies/Analytics')).Analytics;
}

beforeEach(() => {
  pathname = '/pl';
  granted = true;
  assign.mockClear();
  reload.mockClear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: DOC_ORIGIN, href: `${DOC_ORIGIN}/pl`, assign, reload },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('beacon.ts', () => {
  it('konfiguracja beaconu wyłącza śledzenie nawigacji SPA', () => {
    const cfg = JSON.parse(cfBeaconConfig('t')) as { token: string; spa: boolean };
    expect(cfg).toEqual({ token: 't', spa: false });
  });

  it('twarda nawigacja tylko gdy beacon załadowany i cel prywatny', () => {
    expect(needsHardNavigation(true, '/pl/candidate/aplikacje')).toBe(true);
    expect(needsHardNavigation(true, '/pl/logowanie')).toBe(true);
    expect(needsHardNavigation(true, '/pl/oferty-pracy')).toBe(false);
    // kontrola ujemna: beacon nie załadowany (brak zgody) = zwykła nawigacja
    expect(needsHardNavigation(false, '/pl/logowanie')).toBe(false);
  });

  it('linki obce, z target=_blank i download zostają przy domyślnym zachowaniu', () => {
    const a = (attrs: Record<string, string>) => {
      const el = document.createElement('a');
      for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
      return el;
    };
    expect(sameOriginTarget(a({ href: 'http://localhost/pl/logowanie' }), 'http://localhost')?.pathname).toBe('/pl/logowanie');
    expect(sameOriginTarget(a({ href: 'https://example.com/pl/logowanie' }), 'http://localhost')).toBeNull();
    expect(sameOriginTarget(a({ href: '/pl/logowanie', target: '_blank' }), 'http://localhost')).toBeNull();
    expect(sameOriginTarget(a({ href: '/pl/logowanie', download: '' }), 'http://localhost')).toBeNull();
  });
});

describe('<Analytics /> a nawigacje SPA', () => {
  it('wstawia beacon z spa:false po zgodzie na trasie publicznej', async () => {
    const Analytics = await loadAnalytics();
    const { getByTestId } = render(<Analytics />);
    expect(JSON.parse(getByTestId('beacon').getAttribute('data-cf-beacon')!)).toEqual({ token: 'tok-1046', spa: false });
  });

  it('klik w link na trasę prywatną po załadowaniu beaconu = pełne przejście, nie SPA', async () => {
    const Analytics = await loadAnalytics();
    const { getByTestId } = render(
      <>
        <Analytics />
        <a href="/pl/logowanie" data-testid="login">Zaloguj</a>
        <a href="/pl/oferty-pracy" data-testid="offers">Oferty</a>
      </>,
    );
    getByTestId('beacon');
    const publicClick = fireEvent.click(getByTestId('offers'));
    expect(publicClick).toBe(true); // domyślne zachowanie zostaje (Next Link obsłuży SPA)
    expect(assign).not.toHaveBeenCalled();

    const notPrevented = fireEvent.click(getByTestId('login'));
    expect(notPrevented).toBe(false); // preventDefault
    expect(assign).toHaveBeenCalledWith(`${DOC_ORIGIN}/pl/logowanie`);
  });

  it('kontrola ujemna: bez zgody klik w link prywatny nie jest przechwytywany', async () => {
    granted = false;
    const Analytics = await loadAnalytics();
    const { getByTestId, queryByTestId } = render(
      <>
        <Analytics />
        <a href="/pl/logowanie" data-testid="login">Zaloguj</a>
      </>,
    );
    expect(queryByTestId('beacon')).toBeNull();
    expect(fireEvent.click(getByTestId('login'))).toBe(true);
    expect(assign).not.toHaveBeenCalled();
  });

  it('przejście programowe na trasę prywatną po załadowaniu beaconu przeładowuje kartę', async () => {
    const Analytics = await loadAnalytics();
    const { rerender } = render(<Analytics />);
    expect(reload).not.toHaveBeenCalled();
    pathname = '/pl/employer';
    rerender(<Analytics />);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('kontrola ujemna: wejście wprost na trasę prywatną nie przeładowuje (beacon nigdy nie załadowany)', async () => {
    pathname = '/pl/employer';
    const Analytics = await loadAnalytics();
    const { queryByTestId } = render(<Analytics />);
    expect(queryByTestId('beacon')).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });
});
