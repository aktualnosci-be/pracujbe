// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import config from '../../next.config.mjs';
import { MAX_REPORTS_PER_REQUEST, parseCspReports } from '@/lib/security/csp-report';

/**
 * Raporty CSP (#47): parser zostawia tylko opis polityki (dyrektywa, origin zasobu, ścieżka bez
 * query/identyfikatorów), trasa ma limity, a nagłówki kierują raporty na endpoint i ustawiają
 * Referrer-Policy.
 */

const SECRET_EMAIL = 'jan.kowalski@example.invalid';
const SECRET_TOKEN = 'tok_9f8e7d6c5b4a39281706f5e4d3c2b1a0';
const UUID = '3f1c7a52-6f7e-4d0b-9a55-1a2b3c4d5e6f';

const legacyReport = {
  'csp-report': {
    'document-uri': `https://pracuj.be/pl/employer/aplikacje/${UUID}?q=${SECRET_EMAIL}#token=${SECRET_TOKEN}`,
    referrer: `https://pracuj.be/pl/oferty-pracy?keyword=${SECRET_EMAIL}`,
    'violated-directive': "script-src-elem 'self' https://www.googletagmanager.com",
    'effective-directive': 'script-src-elem',
    'original-policy': "default-src 'self'",
    disposition: 'enforce',
    'blocked-uri': `https://evil.example.com/x.js?user=${SECRET_EMAIL}`,
    'line-number': 12,
    'column-number': 7,
    'source-file': `https://pracuj.be/_next/static/chunk.js?session=${SECRET_TOKEN}`,
    'status-code': 200,
    'script-sample': `alert("${SECRET_EMAIL}")`,
  },
};

const reportingApiReport = [
  {
    type: 'csp-violation',
    age: 10,
    url: `https://pracuj.be/pl/potwierdz-email#token=${SECRET_TOKEN}`,
    user_agent: 'Mozilla/5.0 test',
    body: {
      documentURL: `https://pracuj.be/pl/potwierdz-email?next=${SECRET_EMAIL}#token=${SECRET_TOKEN}`,
      referrer: 'https://mail.example.invalid/inbox',
      blockedURL: 'inline',
      effectiveDirective: 'script-src-elem',
      originalPolicy: "default-src 'self'",
      sample: `console.log("${SECRET_TOKEN}")`,
      disposition: 'report',
      statusCode: 200,
      lineNumber: 1,
      columnNumber: 2,
    },
  },
  { type: 'deprecation', body: { id: 'x', message: 'y' } },
];

describe('parseCspReports', () => {
  it('normalizuje format report-uri bez danych z query, fragmentu i próbki', () => {
    const [violation] = parseCspReports(legacyReport)!;
    expect(violation).toEqual({
      directive: 'script-src-elem',
      blocked: 'https://evil.example.com',
      path: '/pl/employer/aplikacje/:id',
      source: 'https://pracuj.be',
      line: 12,
      column: 7,
      disposition: 'enforce',
    });
  });

  it('normalizuje Reporting API i pomija raporty innego typu', () => {
    expect(parseCspReports(reportingApiReport)).toEqual([
      {
        directive: 'script-src-elem',
        blocked: 'inline',
        path: '/pl/potwierdz-email',
        source: null,
        line: 1,
        column: 2,
        disposition: 'report',
      },
    ]);
  });

  it('nie przepuszcza e-maila, tokenu ani identyfikatora — kontrola ujemna na surowym raporcie', () => {
    const raw = JSON.stringify([legacyReport, reportingApiReport]);
    // Kontrola ujemna: fikstura naprawdę zawiera dane, których wynik nie może zawierać.
    for (const secret of [SECRET_EMAIL, SECRET_TOKEN, UUID]) expect(raw).toContain(secret);
    const out = JSON.stringify([parseCspReports(legacyReport), parseCspReports(reportingApiReport)]);
    for (const secret of [SECRET_EMAIL, SECRET_TOKEN, UUID, 'mail.example.invalid', 'Mozilla']) {
      expect(out).not.toContain(secret);
    }
  });

  it('zastępuje długie liczby i tokeny w ścieżce', () => {
    const [v] = parseCspReports({
      'csp-report': {
        'effective-directive': 'img-src',
        'blocked-uri': 'data:image/png;base64,AAAA',
        'document-uri': `https://pracuj.be/pl/aplikacja/przejmij/${SECRET_TOKEN}/12345678`,
      },
    })!;
    expect(v).toMatchObject({ directive: 'img-src', blocked: 'data', path: '/pl/aplikacja/przejmij/:id/:id' });
  });

  it.each([
    ['pusty obiekt', {}],
    ['zła dyrektywa', { 'csp-report': { 'effective-directive': 'script-src; drop table', 'blocked-uri': 'inline' } }],
    ['sama tablica bez csp-violation', [{ type: 'deprecation', body: {} }]],
    ['za dużo raportów', Array.from({ length: MAX_REPORTS_PER_REQUEST + 1 }, () => reportingApiReport[0])],
    ['tekst', 'hello'],
  ])('odrzuca: %s', (_label, payload) => {
    expect(parseCspReports(payload)).toBeNull();
  });

  it('nieznany schemat zasobu nie trafia do logu dosłownie', () => {
    const [v] = parseCspReports({
      'csp-report': { 'effective-directive': 'frame-src', 'blocked-uri': `mailto:${SECRET_EMAIL}` },
    })!;
    expect(v?.blocked).toBe('other-scheme');
  });
});

describe('POST /api/csp-report', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  async function route() {
    return import('@/app/api/csp-report/route');
  }

  function request(body: string, headers: Record<string, string> = {}) {
    return new Request('http://localhost/api/csp-report', {
      method: 'POST',
      body,
      headers: { 'content-type': 'application/csp-report', 'x-real-ip': '203.0.113.7', ...headers },
    });
  }

  it('loguje tylko znormalizowany raport i odpowiada 204 bez treści', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const res = await POST(request(JSON.stringify(legacyReport)));
    expect(res.status).toBe(204);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect(await res.text()).toBe('');
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('script-src-elem');
    for (const secret of [SECRET_EMAIL, SECRET_TOKEN, UUID, '203.0.113.7']) expect(logged).not.toContain(secret);
  });

  it('przyjmuje Reporting API (application/reports+json)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const res = await POST(request(JSON.stringify(reportingApiReport), { 'content-type': 'application/reports+json' }));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['zły typ treści', () => request(JSON.stringify(legacyReport), { 'content-type': 'text/plain' }), 415],
    ['niepoprawny JSON', () => request('{'), 400],
    ['to nie raport CSP', () => request('{"a":1}'), 400],
    ['za duże body', () => request(JSON.stringify({ x: 'a'.repeat(17 * 1024) })), 413],
  ])('%s → %i bez logu', async (_label, make, status) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const res = await POST(make());
    expect(res.status).toBe(status);
    expect(warn).not.toHaveBeenCalled();
  });

  it('limituje żądania z jednego adresu (20/min), inny adres przechodzi', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const body = JSON.stringify(legacyReport);
    for (let i = 0; i < 20; i += 1) expect((await POST(request(body))).status).toBe(204);
    expect((await POST(request(body))).status).toBe(429);
    expect((await POST(request(body, { 'x-real-ip': '198.51.100.1' }))).status).toBe(204);
  });

  const enforcedApiEntry = {
    ...reportingApiReport[0],
    body: { ...reportingApiReport[0]!.body, disposition: 'enforce' },
  };

  it('ogranicza liczbę wpisów w logu na proces (300/min)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const batch = JSON.stringify(Array.from({ length: 10 }, () => enforcedApiEntry));
    for (let i = 0; i < 40; i += 1) {
      await POST(request(batch, { 'content-type': 'application/reports+json', 'x-real-ip': `198.51.100.${i}` }));
    }
    expect(warn).toHaveBeenCalledTimes(300);
  });

  it('#585: szum Report-Only ma osobny budżet (60/min) i nie wypiera raportów egzekwowanych', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const noise = JSON.stringify(Array.from({ length: 10 }, () => reportingApiReport[0]));
    for (let i = 0; i < 40; i += 1) {
      await POST(
        new Request('http://localhost/api/csp-report?policy=report-only', {
          method: 'POST',
          body: noise,
          headers: { 'content-type': 'application/reports+json', 'x-real-ip': `198.51.100.${i}` },
        }),
      );
    }
    expect(warn).toHaveBeenCalledTimes(60);
    // Kontrola ujemna: przy wspólnym budżecie 400 wpisów szumu wyczerpałoby limit 300,
    // a raport egzekwowanej polityki poniżej byłby odrzucony.
    const enforced = JSON.stringify([enforcedApiEntry]);
    const res = await POST(request(enforced, { 'content-type': 'application/reports+json', 'x-real-ip': '192.0.2.1' }));
    expect(res.status).toBe(204);
    expect(warn).toHaveBeenCalledTimes(61);
  });

  it('#585: adres Report-Only ma własny limit żądań (10/min) niezależny od egzekwowanego', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { POST } = await route();
    const reportOnly = () =>
      new Request('http://localhost/api/csp-report?policy=report-only', {
        method: 'POST',
        body: JSON.stringify(legacyReport),
        headers: { 'content-type': 'application/csp-report', 'x-real-ip': '203.0.113.7' },
      });
    for (let i = 0; i < 10; i += 1) expect((await POST(reportOnly())).status).toBe(204);
    expect((await POST(reportOnly())).status).toBe(429);
    expect((await POST(request(JSON.stringify(legacyReport)))).status).toBe(204);
  });

  it('GET → 405', async () => {
    const { GET } = await route();
    expect(GET().status).toBe(405);
  });
});

describe('nagłówki bezpieczeństwa (next.config.mjs)', () => {
  it('Referrer-Policy strict-origin-when-cross-origin i raporty CSP na endpoint', async () => {
    const rules = await config.headers!();
    const all = rules.find((rule) => rule.source === '/:path*')!.headers;
    const get = (key: string) => all.find((header) => header.key === key)?.value;
    expect(get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    const csp = get('Content-Security-Policy')!;
    expect(csp).toContain('report-uri /api/csp-report');
    expect(csp).toContain('report-to csp-endpoint');
    expect(get('Reporting-Endpoints')).toBe('csp-endpoint="/api/csp-report"');
    // Raporty nie osłabiają polityki: nadal egzekwowana (nie Report-Only).
    expect(all.some((header) => header.key === 'Content-Security-Policy-Report-Only')).toBe(false);
    expect(csp).toContain("default-src 'self'");
  });

  async function cspWith(token: string | undefined): Promise<string> {
    vi.stubEnv('NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN', token ?? '');
    try {
      const rules = await config.headers!();
      const all = rules.find((rule) => rule.source === '/:path*')!.headers;
      return all.find((header) => header.key === 'Content-Security-Policy')!.value;
    } finally {
      vi.unstubAllEnvs();
    }
  }

  it('#570: bez tokenu Cloudflare Web Analytics CSP nie dopuszcza hostów beaconu', async () => {
    for (const token of [undefined, '', '   ']) {
      expect(await cspWith(token)).not.toContain('cloudflareinsights.com');
    }
  });

  it('#570: z tokenem CSP dopuszcza skrypt beaconu i jego endpoint (kontrola ujemna)', async () => {
    const csp = await cspWith('test-token');
    expect(csp).toMatch(/script-src [^;]*https:\/\/static\.cloudflareinsights\.com/);
    expect(csp).toMatch(/connect-src [^;]*https:\/\/cloudflareinsights\.com/);
  });
});
