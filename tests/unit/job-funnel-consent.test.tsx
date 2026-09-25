import * as React from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { JobFunnelBeacon } from '@/components/public/JobFunnelBeacon';
import {
  CONSENT_COOKIE_NAME,
  CONSENT_POLICY_VERSION,
  acceptAllCategories,
  necessaryOnly,
} from '@/lib/consent';
import { updateConsent } from '@/lib/consent-store';
import { funnelConsentState, pendingFunnelEventCount, sendFunnelEvent } from '@/lib/job-funnel/client';
import en from '@/messages/en.json';

/**
 * #575 — lejek ofert (#99) tylko po zgodzie w kategorii analitycznej (decyzja właściciela,
 * ePrivacy). Bez POST przed decyzją, po odmowie i po wycofaniu (także w innej karcie = samo
 * cookie, bez zdarzenia w tej karcie, oraz po restarcie = zapisane cookie); wycofanie/odmowa
 * czyści zdarzenia czekające na decyzję. Kontrola ujemna: bramka zgody jest jedynym powodem
 * braku wysyłki (ta sama ścieżka ze zgodą wysyła).
 */

vi.mock('@/lib/actions/applications', () => ({ applyToJob: vi.fn() }));
vi.mock('@/lib/actions/consent', () => ({ recordConsent: vi.fn(async () => undefined) }));
vi.mock('next/navigation', () => ({ usePathname: () => '/pl/oferty-pracy/magazynier' }));
vi.mock('@/i18n/navigation', () => ({
  Link: ({ children, href, ...props }: Omit<React.ComponentProps<'a'>, 'href'> & { href: unknown }) => (
    <a {...props} href={typeof href === 'string' ? href : '#'}>{children}</a>
  ),
}));

globalThis.ResizeObserver ??= class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
} as unknown as typeof ResizeObserver;

const JOB = '3f1c7a52-6f7e-4d0b-9a55-1a2b3c4d5e6f';
const NONCE = '0b1c2d3e-4f50-4617-8a9b-0c1d2e3f4a5b';

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

function events(): string[] {
  return fetchMock.mock.calls.map((call) => {
    const [, init] = call as unknown as [string, RequestInit];
    return (JSON.parse(String(init.body)) as { event: string }).event;
  });
}

/** Zapis cookie zgody bez zdarzenia w tej karcie (inna karta albo poprzednia sesja). */
function writeConsentCookie(analytics: boolean): void {
  const record = {
    v: CONSENT_POLICY_VERSION,
    categories: { necessary: true, preferences: false, analytics, marketing: false },
    ts: '2026-01-01T00:00:00.000Z',
    id: 'funnel-consent-test',
  };
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(record))}; Path=/`;
}

function clearConsentCookie(): void {
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
}

function analyticsOnly() {
  return { ...necessaryOnly(), analytics: true };
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  clearConsentCookie();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearConsentCookie();
});

describe('stan zgody lejka', () => {
  it('brak cookie = przed decyzją, analityka = zgoda, reszta = odmowa', () => {
    expect(funnelConsentState()).toBe('undecided');
    writeConsentCookie(true);
    expect(funnelConsentState()).toBe('granted');
    writeConsentCookie(false);
    expect(funnelConsentState()).toBe('denied');
  });

  it('zgoda z nieaktualnej wersji polityki nie wystarcza', () => {
    const stale = { v: `${CONSENT_POLICY_VERSION}-old`, categories: acceptAllCategories(), ts: 'x', id: 'x' };
    document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(stale))}; Path=/`;
    expect(funnelConsentState()).toBe('undecided');
  });

  it('sendFunnelEvent: bez zgody nic nie wychodzi; kontrola ujemna — ze zgodą to samo wywołanie wysyła', () => {
    sendFunnelEvent('detail_view', [JOB], NONCE);
    writeConsentCookie(false);
    sendFunnelEvent('detail_view', [JOB], NONCE);
    expect(fetchMock).not.toHaveBeenCalled();
    writeConsentCookie(true);
    sendFunnelEvent('detail_view', [JOB], NONCE);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('JobFunnelBeacon bez zgody', () => {
  it('przed decyzją nie wysyła; zdarzenie czeka i wychodzi dopiero po zgodzie analitycznej', () => {
    render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingFunnelEventCount()).toBe(1);
    act(() => {
      updateConsent(analyticsOnly(), 'cookie_banner');
    });
    expect(events()).toEqual(['detail_view']);
    expect(pendingFunnelEventCount()).toBe(0);
  });

  it('odmowa w banerze czyści oczekujące zdarzenie — późniejsza zgoda go nie wyśle', () => {
    render(<JobFunnelBeacon event="search_appearance" jobIds={[JOB]} />);
    act(() => {
      updateConsent(necessaryOnly(), 'cookie_banner');
    });
    expect(pendingFunnelEventCount()).toBe(0);
    act(() => {
      updateConsent(analyticsOnly(), 'cookie_settings');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sama zgoda marketingowa nie włącza lejka', () => {
    render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />);
    act(() => {
      updateConsent({ ...necessaryOnly(), marketing: true }, 'cookie_banner');
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingFunnelEventCount()).toBe(0);
  });

  it('zapisana odmowa (restart przeglądarki) — nic nie wychodzi i nic nie czeka', () => {
    writeConsentCookie(false);
    render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingFunnelEventCount()).toBe(0);
  });

  it('odmontowanie widoku (zmiana strony) usuwa oczekujące zdarzenie', () => {
    const { unmount } = render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />);
    expect(pendingFunnelEventCount()).toBe(1);
    unmount();
    expect(pendingFunnelEventCount()).toBe(0);
    act(() => {
      updateConsent(analyticsOnly(), 'cookie_banner');
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('strona w tle: wycofanie zgody w innej karcie przed pokazaniem karty blokuje wysyłkę', () => {
    writeConsentCookie(true);
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />);
    writeConsentCookie(false); // inna karta: tylko cookie, bez zdarzenia w tej karcie
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('apply_started po wycofaniu zgody', () => {
  function renderPage() {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobFunnelBeacon event="detail_view" jobIds={[JOB]} />
        <ApplyModal jobId={JOB} companyName="ACME" triggerLabel="Apply desktop" />
      </NextIntlClientProvider>,
    );
  }

  it('wycofanie w tej karcie: otwarcie „Aplikuj” nie wysyła apply_started', async () => {
    writeConsentCookie(true);
    renderPage();
    expect(events()).toEqual(['detail_view']);
    act(() => {
      updateConsent(necessaryOnly(), 'footer');
    });
    fireEvent.click(screen.getByRole('button', { name: /Apply desktop/ }));
    await screen.findByRole('dialog');
    expect(events()).toEqual(['detail_view']);
  });

  it('wycofanie w innej karcie (samo cookie): apply_started też nie wychodzi', async () => {
    writeConsentCookie(true);
    renderPage();
    writeConsentCookie(false);
    fireEvent.click(screen.getByRole('button', { name: /Apply desktop/ }));
    await screen.findByRole('dialog');
    expect(events()).toEqual(['detail_view']);
  });

  it('przed decyzją „Aplikuj” nie wysyła i nie kolejkuje apply_started', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Apply desktop/ }));
    await screen.findByRole('dialog');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(pendingFunnelEventCount()).toBe(1); // tylko wyświetlenie szczegółu
  });
});

describe('bundel strony oferty (#575)', () => {
  it('klient lejka czyta zgodę bez Server Action i store’u banera (budżet JS strony oferty)', async () => {
    const { readFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8');
    const imports = (code: string) => [...code.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    for (const banned of ['@/lib/consent', '@/lib/consent-store', '@/lib/actions/consent']) {
      expect(imports(read('src/lib/job-funnel/client.ts'))).not.toContain(banned);
    }
    expect(imports(read('src/lib/consent-cookie.ts'))).toEqual([]);
  });
});
