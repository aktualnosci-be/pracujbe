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
