import { act, cleanup, render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  WITHDRAWN_NOTICE_KEY,
  blockBeaconTraffic,
  isBeaconHost,
  takeWithdrawnNotice,
  withdrawLoadedBeacon,
} from '@/lib/analytics/withdraw';
import pl from '@/messages/pl.json';

/**
 * #642 (Invariant #7): wycofanie zgody na analitykę, gdy beacon Cloudflare jest już w karcie,
 * odcina wysyłkę w bieżącym dokumencie i przeładowuje stronę z komunikatem.
 */

type Listener = (record: { categories: { analytics: boolean } } | null) => void;
let consentListener: Listener | null = null;
let granted = true;
let persistence: Promise<void> = Promise.resolve();

vi.mock('next/navigation', () => ({ usePathname: () => '/pl' }));
vi.mock('next/script', () => ({ default: () => <script data-testid="beacon" /> }));
vi.mock('@/lib/consent', () => ({
  getConsent: () => ({ v: '2.0', categories: { necessary: true, preferences: false, analytics: granted }, ts: '', id: 'x' }),
  pendingConsentPersistence: () => persistence,
}));
vi.mock('@/lib/consent-store', () => ({
  subscribeConsent: (listener: Listener) => {
    consentListener = listener;
    return () => {
      consentListener = null;
    };
  },
}));

const DOC_ORIGIN = new URL(document.URL).origin;
const reload = vi.fn();

function fakeWindow() {
  const sendBeacon = vi.fn((_url: string, _data?: unknown) => true);
  const fetchFn = vi.fn((_input: string) => Promise.resolve(new Response('')));
  const xhrSend = vi.fn();
  class FakeXhr {
    open(_method: string, _url: string) {}
    send(_body?: unknown) {
      xhrSend();
    }
  }
  const doc = document.implementation.createHTMLDocument('t');
  const win = {
    location: { href: 'https://pracuj.be/pl', reload: vi.fn() },
    document: doc,
    navigator: { sendBeacon },
    fetch: fetchFn,
    XMLHttpRequest: FakeXhr,
    sessionStorage: window.sessionStorage,
  };
  return { win: win as unknown as Window, raw: win, sendBeacon, fetchFn, xhrSend, doc };
}

async function loadAnalytics() {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN', 'tok-642');
  return (await import('@/components/cookies/Analytics')).Analytics;
}

beforeEach(() => {
  granted = true;
  consentListener = null;
  persistence = Promise.resolve();
  reload.mockClear();
  window.sessionStorage.clear();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { origin: DOC_ORIGIN, href: `${DOC_ORIGIN}/pl`, assign: vi.fn(), reload },
  });
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe('isBeaconHost', () => {
  it('rozpoznaje hosty Cloudflare Insights, nie inne', () => {
    expect(isBeaconHost('https://cloudflareinsights.com/cdn-cgi/rum')).toBe(true);
    expect(isBeaconHost('https://static.cloudflareinsights.com/beacon.min.js')).toBe(true);
    expect(isBeaconHost('/api/client-error', 'https://pracuj.be/pl')).toBe(false);
    expect(isBeaconHost('https://cloudflareinsights.com.evil.test/x')).toBe(false);
    expect(isBeaconHost('::nie-adres')).toBe(false);
  });
});

describe('blockBeaconTraffic', () => {
  it('kontrola ujemna: bez blokady wysyłka do dostawcy przechodzi', () => {
    const { raw, sendBeacon } = fakeWindow();
    raw.navigator.sendBeacon('https://cloudflareinsights.com/cdn-cgi/rum', '{}');
    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it('odcina sendBeacon, fetch i XHR do dostawcy, przepuszcza własny origin; CSP w <meta>', async () => {
    const { win, raw, sendBeacon, fetchFn, xhrSend, doc } = fakeWindow();
    blockBeaconTraffic(win);
    blockBeaconTraffic(win); // idempotentnie

    expect(raw.navigator.sendBeacon('https://cloudflareinsights.com/cdn-cgi/rum', '{}')).toBe(false);
    expect(sendBeacon).not.toHaveBeenCalled();
    expect(raw.navigator.sendBeacon('/api/job-funnel', '{}')).toBe(true);
    expect(sendBeacon).toHaveBeenCalledTimes(1);

    await expect(raw.fetch('https://cloudflareinsights.com/cdn-cgi/rum')).rejects.toThrow();
    expect(fetchFn).not.toHaveBeenCalled();
    await raw.fetch('/api/x');
    expect(fetchFn).toHaveBeenCalledTimes(1);

    const blocked = new raw.XMLHttpRequest();
    blocked.open('POST', 'https://cloudflareinsights.com/cdn-cgi/rum');
    blocked.send('{}');
    expect(xhrSend).not.toHaveBeenCalled();
    const allowed = new raw.XMLHttpRequest();
    allowed.open('POST', '/api/x');
    allowed.send('{}');
    expect(xhrSend).toHaveBeenCalledTimes(1);

    const metas = doc.head.querySelectorAll('meta[http-equiv="Content-Security-Policy"]');
    expect(metas).toHaveLength(1);
    expect(metas[0]?.getAttribute('content')).toBe("connect-src 'self'");
  });
});

describe('withdrawLoadedBeacon', () => {
  it('przeładowuje dopiero po zapisie zgody w logu serwerowym i zostawia znacznik komunikatu', async () => {
    const { win, raw } = fakeWindow();
    let resolve!: () => void;
    const pending = new Promise<void>((r) => (resolve = r));
    const done = withdrawLoadedBeacon(pending, win, 10_000);
    await Promise.resolve();
    expect(raw.location.reload).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(WITHDRAWN_NOTICE_KEY)).toBe('1');
    resolve();
    await done;
    expect(raw.location.reload).toHaveBeenCalledTimes(1);
  });

  it('zawieszony zapis nie blokuje przeładowania (limit czasu)', async () => {
    vi.useFakeTimers();
    const { win, raw } = fakeWindow();
    const done = withdrawLoadedBeacon(new Promise(() => undefined), win, 3_000);
    await vi.advanceTimersByTimeAsync(3_000);
    await done;
    expect(raw.location.reload).toHaveBeenCalledTimes(1);
  });

  it('znacznik komunikatu jest jednorazowy', () => {
    window.sessionStorage.setItem(WITHDRAWN_NOTICE_KEY, '1');
    expect(takeWithdrawnNotice()).toBe(true);
    expect(takeWithdrawnNotice()).toBe(false);
  });
});

describe('<Analytics /> a wycofanie zgody', () => {
  it('wycofanie przy załadowanym beaconie przeładowuje stronę', async () => {
    const Analytics = await loadAnalytics();
    const { getByTestId } = render(<Analytics />);
    expect(getByTestId('beacon')).toBeTruthy();
    await act(async () => {
      consentListener?.({ categories: { analytics: false } });
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(document.querySelector('meta[http-equiv="Content-Security-Policy"]')).not.toBeNull();
    document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.remove();
    delete (window as { __pracujbeBeaconBlocked?: boolean }).__pracujbeBeaconBlocked;
  });

  it('kontrola ujemna: beacon nigdy nie załadowany (brak zgody) — zapis bez przeładowania', async () => {
    granted = false;
    const Analytics = await loadAnalytics();
    const { queryByTestId } = render(<Analytics />);
    expect(queryByTestId('beacon')).toBeNull();
    await act(async () => {
      consentListener?.({ categories: { analytics: false } });
      await Promise.resolve();
    });
    expect(reload).not.toHaveBeenCalled();
  });

  it('kontrola ujemna: zmiana innej kategorii przy utrzymanej analityce nie przeładowuje', async () => {
    const Analytics = await loadAnalytics();
    render(<Analytics />);
    await act(async () => {
      consentListener?.({ categories: { analytics: true } });
      await Promise.resolve();
    });
    expect(reload).not.toHaveBeenCalled();
  });
});

describe('<AnalyticsWithdrawnNotice />', () => {
  async function renderNotice() {
    const { AnalyticsWithdrawnNotice } = await import('@/components/cookies/AnalyticsWithdrawnNotice');
    return render(
      <NextIntlClientProvider locale="pl" messages={pl}>
        <AnalyticsWithdrawnNotice />
      </NextIntlClientProvider>,
    );
  }

  it('po przeładowaniu ze znacznikiem pokazuje komunikat w regionie na żywo', async () => {
    window.sessionStorage.setItem(WITHDRAWN_NOTICE_KEY, '1');
    await renderNotice();
    await vi.waitFor(() => {
      const status = document.querySelector('[role="status"]');
      expect(status?.textContent).toContain(pl.cookies.analyticsWithdrawnNotice);
    });
    expect(window.sessionStorage.getItem(WITHDRAWN_NOTICE_KEY)).toBeNull();
  });

  it('kontrola ujemna: bez znacznika nic nie renderuje', async () => {
    await renderNotice();
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    expect(document.body.textContent).not.toContain(pl.cookies.analyticsWithdrawnNotice);
    expect(document.querySelector('[data-toast-live-regions]')).toBeNull();
  });
});
