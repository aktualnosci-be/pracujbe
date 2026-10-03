import { describe, expect, it } from 'vitest';

import { classifyAuditResult } from '../../scripts/lib/sca-audit-outcome.mjs';

/**
 * #607 — bramka SCA nie może traktować „brak dowodu” jak „brak podatności”. Trzy wyniki:
 * clean/vulnerable (audyt policzony), recognized_transient (jawnie rozpoznana awaria
 * przejściowa dostawcy — nie blokuje CI) i unrecognized (wszystko inne — blokuje CI).
 * Przed #607 puste/niepoprawne/pozbawione metadanych JSON kończyły się kodem 0 —
 * każdy taki przypadek ma tu kontrolę ujemną (musiałby wcześniej dać `unrecognized`,
 * a nie `clean`).
 */

describe('classifyAuditResult — audyt policzony', () => {
  it('clean gdy high i critical wynoszą 0', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 0, critical: 0, moderate: 3 } } }),
      stderr: '',
    });
    expect(result).toEqual({ status: 'clean', high: 0, critical: 0 });
  });

  it('vulnerable gdy high+critical > 0', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 2, critical: 1 } } }),
      stderr: '',
    });
    expect(result).toEqual({ status: 'vulnerable', high: 2, critical: 1 });
  });

  it('brakujące liczby w vulnerabilities liczą się jako 0, nie NaN', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ metadata: { vulnerabilities: {} } }),
      stderr: '',
    });
    expect(result).toEqual({ status: 'clean', high: 0, critical: 0 });
  });
});

describe('classifyAuditResult — wartości spoza kontraktu npm audit (#643)', () => {
  it.each([
    ['tekst zamiast liczby', { high: 'n/a', critical: 0 }],
    ['liczba ujemna', { high: 0, critical: -5 }],
    ['ułamek', { high: 1.5, critical: 0 }],
    ['null jawnie w polu high, ale critical niepoprawny', { high: null, critical: 'x' }],
    ['tablica zamiast liczby', { high: [1], critical: 0 }],
    ['obiekt zamiast liczby', { high: { n: 1 }, critical: 0 }],
    ['boolean zamiast liczby', { high: true, critical: 0 }],
  ])('unrecognized gdy metadata.vulnerabilities.high/critical zawiera %s — BLOKUJE (kontrola ujemna)', (_label, vulnerabilities) => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ metadata: { vulnerabilities } }),
      stderr: '',
    });
    expect(result.status).toBe('unrecognized');
    expect(result).not.toHaveProperty('high');
    expect(result).not.toHaveProperty('critical');
  });

  // JSON nie zna NaN/Infinity jako literałów liczbowych (nie przetrwają JSON.stringify —
  // stają się `null`), więc odtwarzamy dokładnie to, co realny `npm audit --json` mógłby
  // wypisać dla takich wartości: niepoprawny tekst JSON. Funkcja MUSI to nadal zablokować
  // (inną gałęzią — niepoprawny JSON — ale ten sam wynik: `unrecognized`, nigdy `clean`).
  it.each(['NaN', 'Infinity', '-Infinity'])(
    'unrecognized (przez niepoprawny JSON) gdy stdout zawiera literał %s w polu vulnerabilities — BLOKUJE (kontrola ujemna)',
    (literal) => {
      const result = classifyAuditResult({
        stdout: `{"metadata":{"vulnerabilities":{"high":${literal},"critical":0}}}`,
        stderr: '',
      });
      expect(result.status).toBe('unrecognized');
      expect(result).not.toHaveProperty('high');
      expect(result).not.toHaveProperty('critical');
    },
  );

  it('nie klasyfikuje jako clean, mimo że suma zniekształconych wartości wygląda na 0 lub ujemną (kontrola ujemna głównego scenariusza #643)', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 'n/a', critical: -5 } } }),
      stderr: '',
    });
    expect(result.status).not.toBe('clean');
    expect(result.status).toBe('unrecognized');
  });

  it('duża, ale poprawna liczba całkowita nadal daje vulnerable (nie jest to regres kontraktu)', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ metadata: { vulnerabilities: { high: 100, critical: 0 } } }),
      stderr: '',
    });
    expect(result).toEqual({ status: 'vulnerable', high: 100, critical: 0 });
  });
});

describe('classifyAuditResult — pusty wynik (#607)', () => {
  it('unrecognized gdy stdout jest puste bez rozpoznanej przyczyny w stderr — BLOKUJE (kontrola ujemna)', () => {
    const result = classifyAuditResult({ stdout: '', stderr: '' });
    expect(result.status).toBe('unrecognized');
  });

  it.each(['npm error code ENOTFOUND', 'connect ETIMEDOUT 1.2.3.4:443', 'read ECONNRESET', 'This endpoint is being retired'])(
    'recognized_transient gdy stderr zawiera jawną sygnaturę sieciową: %s',
    (stderr) => {
      const result = classifyAuditResult({ stdout: '', stderr });
      expect(result.status).toBe('recognized_transient');
    },
  );

  it('stderr z nieznanym błędem NIE jest rozpoznany — unrecognized', () => {
    const result = classifyAuditResult({ stdout: '', stderr: 'jakiś inny, nieoczekiwany błąd' });
    expect(result.status).toBe('unrecognized');
  });
});

describe('classifyAuditResult — niepoprawny JSON (#607)', () => {
  it('unrecognized dla losowego niepoprawnego tekstu — BLOKUJE (kontrola ujemna)', () => {
    const result = classifyAuditResult({ stdout: 'not json at all {{{', stderr: '' });
    expect(result.status).toBe('unrecognized');
  });

  it('recognized_transient gdy endpoint zwrócił stronę HTML zamiast JSON', () => {
    const result = classifyAuditResult({
      stdout: '<html><body>502 Bad Gateway</body></html>',
      stderr: '',
    });
    expect(result.status).toBe('recognized_transient');
  });

  it('recognized_transient gdy niepoprawny JSON towarzyszy jawnej sygnaturze sieciowej', () => {
    const result = classifyAuditResult({ stdout: 'garbage', stderr: 'getaddrinfo ENOTFOUND registry.npmjs.org' });
    expect(result.status).toBe('recognized_transient');
  });
});

describe('classifyAuditResult — JSON bez metadata.vulnerabilities (#607, dawny „NOMETA”)', () => {
  it('unrecognized gdy JSON nie ma ani metadata, ani error — BLOKUJE (kontrola ujemna głównego scenariusza issue)', () => {
    const result = classifyAuditResult({ stdout: JSON.stringify({ foo: 'bar' }), stderr: '' });
    expect(result.status).toBe('unrecognized');
  });

  it('recognized_transient gdy npm zgłasza własny, ustrukturyzowany błąd audytu (ENOAUDIT)', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ error: { code: 'ENOAUDIT', summary: 'audit endpoint returned an error' } }),
      stderr: '',
    });
    expect(result.status).toBe('recognized_transient');
  });

  it('unrecognized gdy pole error istnieje, ale kod/treść nie są rozpoznane', () => {
    const result = classifyAuditResult({
      stdout: JSON.stringify({ error: { code: 'ETOTALLYUNKNOWN', summary: 'coś innego' } }),
      stderr: '',
    });
    expect(result.status).toBe('unrecognized');
  });
});

/**
 * Wyjątek dla porady GHSA-vfj7-8cjw-p6xm (braces, decyzja właściciela 2026-10-03). Wynik
 * liczony z porad (`vulnerabilities`/`via`), nie z sum metadanych: wpis high/critical jest
 * pomijany tylko, gdy WSZYSTKIE jego porady high/critical są objęte aktywnym wyjątkiem.
 */
describe('classifyAuditResult — wyjątek z terminem dla jednej porady', () => {
  const BRACES_GHSA = 'GHSA-vfj7-8cjw-p6xm';
  const OTHER_GHSA = 'GHSA-xxxx-xxxx-xxxx'.replace(/x/g, '2');
  const exceptions = [
    { advisory: BRACES_GHSA, package: 'braces', expiresOn: '2026-11-02', reason: 'Tylko narzędzia budowania.' },
  ];
  const before = new Date('2026-10-03T12:00:00Z');

  function advisory(name: string, ghsa: string, severity = 'high') {
    return {
      source: 1,
      name,
      dependency: name,
      title: 't',
      url: `https://github.com/advisories/${ghsa}`,
      severity,
      range: '<=3.0.3',
    };
  }

  /** Kształt zgodny z realnym `npm audit --json` dla drzewa braces na main (8 wpisów high). */
  function bracesTree(extra: Record<string, unknown> = {}) {
    const vulnerabilities: Record<string, unknown> = {
      braces: { name: 'braces', severity: 'high', via: [advisory('braces', BRACES_GHSA)] },
      micromatch: { name: 'micromatch', severity: 'high', via: ['braces'] },
      chokidar: { name: 'chokidar', severity: 'high', via: ['braces'] },
      'fast-glob': { name: 'fast-glob', severity: 'high', via: ['micromatch'] },
      tailwindcss: { name: 'tailwindcss', severity: 'high', via: ['chokidar', 'fast-glob', 'micromatch'] },
      'tailwindcss-animate': { name: 'tailwindcss-animate', severity: 'high', via: ['tailwindcss'] },
      ...extra,
    };
    const blocking = Object.values(vulnerabilities).filter((v) =>
      ['high', 'critical'].includes((v as { severity: string }).severity),
    );
    const critical = blocking.filter((v) => (v as { severity: string }).severity === 'critical').length;
    return JSON.stringify({
      vulnerabilities,
      metadata: { vulnerabilities: { high: blocking.length - critical, critical } },
    });
  }

  it('sama porada objęta wyjątkiem → clean (z listą pominiętych porad)', () => {
    const result = classifyAuditResult({ stdout: bracesTree(), stderr: '' }, { exceptions, now: before });
    expect(result).toEqual({ status: 'clean', high: 0, critical: 0, excepted: [BRACES_GHSA] });
  });

  it('wyjątek obowiązuje do końca dnia terminu włącznie', () => {
    const result = classifyAuditResult(
      { stdout: bracesTree(), stderr: '' },
      { exceptions, now: new Date('2026-11-02T23:59:00Z') },
    );
    expect(result.status).toBe('clean');
  });

  it('wyjątek + inna porada high → BLOKUJE', () => {
    const stdout = bracesTree({
      lodash: { name: 'lodash', severity: 'high', via: [advisory('lodash', OTHER_GHSA)] },
    });
    const result = classifyAuditResult({ stdout, stderr: '' }, { exceptions, now: before });
    expect(result).toMatchObject({ status: 'vulnerable', high: 1, critical: 0 });
  });

  it('pakiet zależny od braces i od innej porady high → BLOKUJE (wyjątek nie ukrywa drugiej przyczyny)', () => {
    const vulnerabilities = JSON.parse(bracesTree()).vulnerabilities;
    vulnerabilities.micromatch.via = ['braces', advisory('micromatch', OTHER_GHSA)];
    const stdout = JSON.stringify({ vulnerabilities, metadata: { vulnerabilities: { high: 6, critical: 0 } } });
    const result = classifyAuditResult({ stdout, stderr: '' }, { exceptions, now: before });
    expect(result.status).toBe('vulnerable');
    // micromatch, fast-glob i tailwindcss(+animate) dziedziczą drugą poradę.
    expect(result).toMatchObject({ high: 4 });
  });

  it('wyjątek po terminie → BLOKUJE', () => {
    const result = classifyAuditResult(
      { stdout: bracesTree(), stderr: '' },
      { exceptions, now: new Date('2026-11-03T00:00:00Z') },
    );
    expect(result).toMatchObject({ status: 'vulnerable', high: 6 });
  });

  it('ten sam pakiet, inna porada → BLOKUJE', () => {
    const vulnerabilities = JSON.parse(bracesTree()).vulnerabilities;
    vulnerabilities.braces.via = [advisory('braces', OTHER_GHSA)];
    const stdout = JSON.stringify({ vulnerabilities, metadata: { vulnerabilities: { high: 6, critical: 0 } } });
    const result = classifyAuditResult({ stdout, stderr: '' }, { exceptions, now: before });
    expect(result).toMatchObject({ status: 'vulnerable', high: 6 });
  });

  it('ta sama porada, inny pakiet → BLOKUJE', () => {
    const vulnerabilities = JSON.parse(bracesTree()).vulnerabilities;
    vulnerabilities.braces.via = [advisory('not-braces', BRACES_GHSA)];
    const stdout = JSON.stringify({ vulnerabilities, metadata: { vulnerabilities: { high: 6, critical: 0 } } });
    const result = classifyAuditResult({ stdout, stderr: '' }, { exceptions, now: before });
    expect(result.status).toBe('vulnerable');
  });

  it('kontrola ujemna: bez wyjątku to samo drzewo BLOKUJE', () => {
    expect(classifyAuditResult({ stdout: bracesTree(), stderr: '' }, { now: before })).toMatchObject({
      status: 'vulnerable',
      high: 6,
    });
    expect(classifyAuditResult({ stdout: bracesTree(), stderr: '' }, { exceptions: [], now: before }).status).toBe(
      'vulnerable',
    );
  });

  it.each([
    ['bez powodu', { advisory: BRACES_GHSA, package: 'braces', expiresOn: '2026-11-02', reason: '' }],
    ['zły format terminu', { advisory: BRACES_GHSA, package: 'braces', expiresOn: '2.11.2026', reason: 'x' }],
    ['bez pakietu', { advisory: BRACES_GHSA, expiresOn: '2026-11-02', reason: 'x' }],
  ])('niepoprawny wpis wyjątku (%s) niczego nie zwalnia — BLOKUJE', (_label, entry) => {
    const result = classifyAuditResult({ stdout: bracesTree(), stderr: '' }, { exceptions: [entry], now: before });
    expect(result.status).toBe('vulnerable');
  });

  it('sumy metadanych niezgodne z mapą porad → unrecognized (BLOKUJE)', () => {
    const parsed = JSON.parse(bracesTree());
    parsed.metadata.vulnerabilities.high = 9;
    const result = classifyAuditResult({ stdout: JSON.stringify(parsed), stderr: '' }, { exceptions, now: before });
    expect(result.status).toBe('unrecognized');
  });

  it.each([
    ['wpis bez via', { name: 'x', severity: 'high' }],
    ['via wskazuje nieistniejący pakiet', { name: 'x', severity: 'high', via: ['ghost'] }],
    ['via z pustą listą', { name: 'x', severity: 'high', via: [] }],
    ['nieznane severity', { name: 'x', severity: 'urgent', via: ['braces'] }],
  ])('struktura spoza kontraktu (%s) → unrecognized (BLOKUJE)', (_label, entry) => {
    const vulnerabilities = { ...JSON.parse(bracesTree()).vulnerabilities, x: entry };
    const stdout = JSON.stringify({ vulnerabilities, metadata: { vulnerabilities: { high: 7, critical: 0 } } });
    const result = classifyAuditResult({ stdout, stderr: '' }, { exceptions, now: before });
    expect(result.status).toBe('unrecognized');
  });

  it('plik wyjątków w repo: dokładnie jedna porada braces z terminem 2026-11-02', async () => {
    const { readFileSync } = await import('node:fs');
    const data = JSON.parse(readFileSync('scripts/lib/sca-audit-exceptions.json', 'utf8'));
    expect(data).toHaveLength(1);
    expect(data[0]).toMatchObject({ advisory: BRACES_GHSA, package: 'braces', expiresOn: '2026-11-02' });
    expect(classifyAuditResult({ stdout: bracesTree(), stderr: '' }, { exceptions: data, now: before }).status).toBe(
      'clean',
    );
  });
});
