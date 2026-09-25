import * as React from 'react';
import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApplyModal } from '@/components/public/ApplyModal';
import { JobFunnelBeacon } from '@/components/public/JobFunnelBeacon';
import { CONSENT_COOKIE_NAME, CONSENT_POLICY_VERSION } from '@/lib/consent';
import en from '@/messages/en.json';

/**
 * Wyspa lejka ofert (#99): jedno żądanie na wyświetlenie (także przy podwójnym efekcie
 * StrictMode), bez cookies (`credentials: 'omit'`), bez storage; otwarcie „Aplikuj” wysyła
 * `apply_started` z nonce bieżącego wyświetlenia (oba przyciski dzielą jeden nonce).
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
const JOB2 = '9b2e4c10-1111-4222-8333-444455556666';

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

function sentBodies() {
  return fetchMock.mock.calls.map((call) => {
    const [url, init] = call as unknown as [string, RequestInit];
    return { url, init, body: JSON.parse(String(init.body)) as { event: string; nonce: string; jobIds: string[] } };
  });
}

/** Zgoda analityczna zapisana wcześniej (#575: lejek wysyła tylko po zgodzie). */
function setStoredConsent(analytics: boolean): void {
  const record = {
    v: CONSENT_POLICY_VERSION,
    categories: { necessary: true, preferences: false, analytics, marketing: false },
    ts: '2026-01-01T00:00:00.000Z',
    id: 'funnel-client-test',
  };
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(record))}; Path=/`;
}

function clearStoredConsent(): void {
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  setStoredConsent(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  clearStoredConsent();
});

describe('JobFunnelBeacon', () => {
  it('sends one detail view per page view, without cookies, even with StrictMode double effects', () => {
    render(<StrictMode><JobFunnelBeacon event="detail_view" jobIds={[JOB]} /></StrictMode>);
    const sent = sentBodies();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe('/api/job-funnel');
    expect(sent[0]!.init).toMatchObject({ method: 'POST', credentials: 'omit', keepalive: true, cache: 'no-store' });
    expect(sent[0]!.body).toEqual({ event: 'detail_view', nonce: expect.stringMatching(/^[0-9a-f-]{36}$/), jobIds: [JOB] });
    // Brak zapisu na urządzeniu (Invariant #7) — jedyne cookie to zgoda z testu.
    expect(document.cookie.split('; ').map((c) => c.split('=')[0])).toEqual([CONSENT_COOKIE_NAME]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it('waits until a background or prerendered page becomes visible', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />);
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    document.dispatchEvent(new Event('visibilitychange'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a new list view with a new nonce when the results change, and nothing for an empty list', () => {
    const { rerender } = render(<JobFunnelBeacon event="search_appearance" jobIds={[JOB]} />);
    rerender(<JobFunnelBeacon event="search_appearance" jobIds={[JOB]} />);
    rerender(<JobFunnelBeacon event="search_appearance" jobIds={[JOB, JOB2]} />);
    rerender(<JobFunnelBeacon event="search_appearance" jobIds={[]} />);
    const sent = sentBodies();
    expect(sent.map((s) => s.body.jobIds)).toEqual([[JOB], [JOB, JOB2]]);
    expect(sent[0]!.body.nonce).not.toBe(sent[1]!.body.nonce);
  });

  it('swallows network errors', () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    expect(() => render(<JobFunnelBeacon event="detail_view" jobIds={[JOB]} />)).not.toThrow();
  });
});

describe('ApplyModal — apply_started (#99)', () => {
  function renderPage(demo = false) {
    render(
      <NextIntlClientProvider locale="en" messages={en}>
        <JobFunnelBeacon event="detail_view" jobIds={[JOB]} />
        <ApplyModal jobId={JOB} companyName="ACME" triggerLabel="Apply desktop" demo={demo} />
        <ApplyModal jobId={JOB} companyName="ACME" triggerLabel="Apply mobile" demo={demo} />
      </NextIntlClientProvider>,
    );
  }

  it('reports opening the form with the nonce of the current job view', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /Apply desktop/ }));
    await screen.findByRole('dialog');
    const sent = sentBodies();
    expect(sent.map((s) => s.body.event)).toEqual(['detail_view', 'apply_started']);
    expect(sent[1]!.body).toEqual({ event: 'apply_started', nonce: sent[0]!.body.nonce, jobIds: [JOB] });
  });

  it('does not report a demo job', async () => {
    renderPage(true);
    fetchMock.mockClear();
    fireEvent.click(screen.getByRole('button', { name: /Apply desktop/ }));
    await screen.findByRole('dialog');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
