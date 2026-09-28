import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EmployerApplyChannel } from '@/components/public/EmployerApplyChannel';
import { CONSENT_COOKIE_NAME, CONSENT_POLICY_VERSION } from '@/lib/consent';
import { APPLY_LINK_REL, buildApplyLinks, isApplyLinkHref } from '@/lib/job-apply-links';
import type { JobApplyChannel } from '@/lib/jobs';
import en from '@/messages/en.json';
import fr from '@/messages/fr.json';
import nl from '@/messages/nl.json';
import pl from '@/messages/pl.json';

/**
 * #1130 — „Aplikuj u pracodawcy” (decyzja produktowa: portal ogłoszeniowy). Przycisk prowadzi
 * wyłącznie do kanału ogłoszeniodawcy (https w nowej karcie z `rel` bez opener/referrer/rankingu,
 * `mailto:`, `tel:`), oferta bez kanału = brak przycisku i neutralny komunikat, kliknięcie liczy
 * `apply_started` tylko po zgodzie analitycznej (#575) i nigdy dla oferty demo.
 */

const JOB = '3f1c7a52-6f7e-4d0b-9a55-1a2b3c4d5e6f';
const FULL: JobApplyChannel = {
  url: 'https://jobs.example.com/apply?id=7',
  email: 'hr@example.com',
  phone: '+32470123456',
};

const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

function writeConsentCookie(analytics: boolean): void {
  const record = {
    v: CONSENT_POLICY_VERSION,
    categories: { necessary: true, preferences: false, analytics },
    ts: '2026-01-01T00:00:00.000Z',
    id: 'employer-apply-test',
  };
  document.cookie = `${CONSENT_COOKIE_NAME}=${encodeURIComponent(JSON.stringify(record))}; Path=/`;
}

beforeEach(() => {
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  document.cookie = `${CONSENT_COOKIE_NAME}=; Max-Age=0; Path=/`;
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderChannel(props: Partial<React.ComponentProps<typeof EmployerApplyChannel>> = {}, messages = pl) {
  return render(
    <NextIntlClientProvider locale="pl" messages={messages}>
      <EmployerApplyChannel jobId={JOB} jobTitle="Magazynier & kierowca" channel={FULL} variant="box" {...props} />
    </NextIntlClientProvider>,
  );
}

describe('buildApplyLinks', () => {
  it('kolejność url → e-mail → telefon, schematy https/mailto/tel', () => {
    const links = buildApplyLinks(FULL, 'Oferta: A & B');
    expect(links.map((l) => l.kind)).toEqual(['url', 'email', 'phone']);
    expect(links.map((l) => l.href)).toEqual([
      'https://jobs.example.com/apply?id=7',
      'mailto:hr@example.com?subject=Oferta%3A%20A%20%26%20B',
      'tel:+32470123456',
    ]);
    expect(links[0]).toMatchObject({ display: 'jobs.example.com', external: true });
    expect(links.slice(1).every((l) => !l.external)).toBe(true);
    expect(links.every((l) => isApplyLinkHref(l.href))).toBe(true);
  });

  it('telefon w zapisie z odstępami jest normalizowany', () => {
    expect(buildApplyLinks({ phone: '0032 470 12 34 56' }, '')[0]?.href).toBe('tel:+32470123456');
  });

  it('wartość spoza reguł kanału nie daje linku (drugi raz te same reguły co baza)', () => {
    const bad: JobApplyChannel = {
      url: 'javascript:alert(1)',
      email: 'hr@example.com?cc=x@evil.test',
      phone: '470123456',
    };
    expect(buildApplyLinks(bad, 'x')).toEqual([]);
    expect(buildApplyLinks({ url: 'http://example.com/apply' }, 'x')).toEqual([]);
    expect(buildApplyLinks(undefined, 'x')).toEqual([]);
  });

  it('kontrola ujemna strażnika schematów: inne schematy są odrzucane', () => {
    for (const href of ['http://example.com', 'javascript:alert(1)', '/pl/logowanie', 'tel:470', 'data:text/html,x']) {
      expect(isApplyLinkHref(href), href).toBe(false);
    }
  });
});

describe('EmployerApplyChannel', () => {
  it('przycisk główny = strona ogłoszeniodawcy w nowej karcie, pozostałe kanały pod spodem', () => {
    renderChannel();
    const primary = screen.getByTestId('employer-apply-primary');
    expect(primary).toHaveAttribute('href', FULL.url);
    expect(primary).toHaveAttribute('target', '_blank');
    expect(primary).toHaveAttribute('rel', APPLY_LINK_REL);
    expect(APPLY_LINK_REL.split(' ').sort()).toEqual(['nofollow', 'noopener', 'noreferrer']);
    expect(primary).toHaveTextContent(pl.job.employerApply.button);
    expect(primary).toHaveTextContent(pl.job.employerApply.newTab);

    const mail = screen.getByRole('link', { name: /hr@example\.com/ });
    expect(mail.getAttribute('href')).toMatch(/^mailto:hr@example\.com\?subject=/);
    expect(mail).not.toHaveAttribute('target');
    expect(screen.getByRole('link', { name: /\+32470123456/ })).toHaveAttribute('href', 'tel:+32470123456');
    // Jedyne cele linków w komponencie = kanały ogłoszeniodawcy.
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href') ?? '');
    expect(hrefs.every(isApplyLinkHref)).toBe(true);
    expect(hrefs).toHaveLength(3);
  });

  it('sam e-mail: przycisk główny to mailto bez nowej karty', () => {
    renderChannel({ channel: { email: 'hr@example.com' } });
    const primary = screen.getByTestId('employer-apply-primary');
    expect(primary.getAttribute('href')).toMatch(/^mailto:/);
    expect(primary).not.toHaveAttribute('target');
    expect(primary).not.toHaveTextContent(pl.job.employerApply.newTab);
  });

  it('pasek mobilny: tylko przycisk główny', () => {
    renderChannel({ variant: 'bar' });
    expect(screen.getAllByRole('link')).toHaveLength(1);
  });

  it('oferta bez kanału: brak przycisku, neutralny komunikat (ramka) i nic w pasku', () => {
    const { unmount } = renderChannel({ channel: undefined });
    expect(screen.queryByRole('link')).toBeNull();
    expect(screen.getByTestId('employer-apply-none')).toHaveTextContent(pl.job.employerApply.none);
    unmount();
    const { container } = renderChannel({ channel: undefined, variant: 'bar' });
    expect(container).toBeEmptyDOMElement();
  });

  it('lejek: bez zgody analitycznej kliknięcie nic nie wysyła', () => {
    renderChannel();
    fireEvent.click(screen.getByTestId('employer-apply-primary'));
    writeConsentCookie(false);
    fireEvent.click(screen.getByTestId('employer-apply-primary'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lejek: po zgodzie kliknięcie = apply_started (kontrola ujemna bramki zgody)', () => {
    writeConsentCookie(true);
    renderChannel();
    fireEvent.click(screen.getByTestId('employer-apply-primary'));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({ event: 'apply_started', jobIds: [JOB] });
  });

  it('lejek: oferta demo nie jest liczona nawet po zgodzie', () => {
    writeConsentCookie(true);
    renderChannel({ demo: true });
    fireEvent.click(screen.getByTestId('employer-apply-primary'));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([['pl', pl], ['nl', nl], ['fr', fr], ['en', en]] as const)('teksty w %s', (_locale, messages) => {
    const t = messages.job.employerApply;
    for (const key of ['boxTitle', 'boxText', 'button', 'newTab', 'otherWays', 'none', 'mailSubject', 'contact'] as const) {
      expect(t[key].trim(), key).not.toBe('');
    }
    expect(t.mailSubject).toContain('{title}');
    for (const kind of ['url', 'email', 'phone'] as const) expect(t.hint[kind]).toContain('{value}');
  });
});
