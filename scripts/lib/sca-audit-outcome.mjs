/**
 * Klasyfikacja wyniku `npm audit --json --package-lock-only` dla bramki SCA (#607).
 *
 * Bramka MUSI odróżnić trzy sytuacje:
 * - `clean`/`vulnerable` — audyt policzony, mamy liczby high/critical (dowód);
 * - `recognized_transient` — audyt NIE został policzony, ale przyczyna jest jawnie
 *   rozpoznana jako przejściowa awaria dostawcy (sieć/HTTP/ustrukturyzowany błąd npm)
 *   — nie blokujemy CI na fladze infrastruktury, ale nie udajemy sukcesu bez powodu;
 * - `unrecognized` — pusty/niepoprawny/pozbawiony metadanych wynik BEZ rozpoznanej
 *   przyczyny. Wcześniej to również kończyło się kodem 0 (błąd z #607); teraz blokuje,
 *   bo nie mamy dowodu ani czystego audytu, ani znanej awarii przejściowej.
 *
 * Bez I/O ani wywołań `npm` — testowalne na sztucznych `stdout`/`stderr`.
 */

/** Sygnatury sieciowe npm/Node, które jawnie wskazują na niedostępność rejestru/audytu. */
const TRANSIENT_STDERR_PATTERNS = [
  /\bENOTFOUND\b/,
  /\bETIMEDOUT\b/,
  /\bECONNRESET\b/,
  /\bECONNREFUSED\b/,
  /\bEAI_AGAIN\b/,
  /\bsocket hang up\b/i,
  /This endpoint is being retired/i,
];

/** Kody błędów npm oznaczające, że TO AUDYT (nie my) zgłosił awarię — ustrukturyzowane `error`. */
const TRANSIENT_NPM_ERROR_CODES = new Set(['ENOAUDIT', 'EAUDITNOPJSON', 'ECONNREFUSED', 'ETIMEDOUT']);

function looksLikeHtml(text) {
  return /^\s*<(!doctype|html)\b/i.test(text);
}

function matchesTransientStderr(stderr) {
  const text = stderr ?? '';
  const pattern = TRANSIENT_STDERR_PATTERNS.find((p) => p.test(text));
  return pattern ? pattern.source : null;
}

/**
 * @param {{ stdout: string, stderr: string }} result
 * @returns {
 *   | { status: 'clean' | 'vulnerable', high: number, critical: number }
 *   | { status: 'recognized_transient' | 'unrecognized', reason: string }
 * }
 */
export function classifyAuditResult({ stdout, stderr }) {
  const trimmedStdout = (stdout ?? '').trim();

  if (!trimmedStdout) {
    const stderrMatch = matchesTransientStderr(stderr);
    if (stderrMatch) {
      return { status: 'recognized_transient', reason: `pusty wynik, stderr pasuje do ${stderrMatch}` };
    }
    return { status: 'unrecognized', reason: 'pusty wynik npm audit bez rozpoznanej przyczyny w stderr' };
  }

  let parsed;
  try {
    parsed = JSON.parse(trimmedStdout);
  } catch {
    if (looksLikeHtml(trimmedStdout)) {
      return { status: 'recognized_transient', reason: 'endpoint audytu zwrócił HTML zamiast JSON' };
    }
    const stderrMatch = matchesTransientStderr(stderr);
    if (stderrMatch) {
      return { status: 'recognized_transient', reason: `niepoprawny JSON, stderr pasuje do ${stderrMatch}` };
    }
    return { status: 'unrecognized', reason: 'niepoprawny JSON bez rozpoznanej przyczyny' };
  }

  const vulnerabilities = parsed?.metadata?.vulnerabilities;
  if (vulnerabilities && typeof vulnerabilities === 'object') {
    const high = Number(vulnerabilities.high) || 0;
    const critical = Number(vulnerabilities.critical) || 0;
    return { status: high + critical > 0 ? 'vulnerable' : 'clean', high, critical };
  }

  if (parsed && typeof parsed.error === 'object' && parsed.error !== null) {
    const code = typeof parsed.error.code === 'string' ? parsed.error.code : null;
    const summary = typeof parsed.error.summary === 'string' ? parsed.error.summary : null;
    if ((code && TRANSIENT_NPM_ERROR_CODES.has(code)) || /audit endpoint/i.test(summary ?? '')) {
      return {
        status: 'recognized_transient',
        reason: `npm zgłosił błąd audytu: ${code ?? 'brak kodu'}${summary ? ` — ${summary}` : ''}`,
      };
    }
    return {
      status: 'unrecognized',
      reason: `JSON z nierozpoznanym polem error: ${code ?? 'brak kodu'}${summary ? ` — ${summary}` : ''}`,
    };
  }

  return { status: 'unrecognized', reason: 'JSON bez metadata.vulnerabilities i bez pola error' };
}

// CLI: `node sca-audit-outcome.mjs <plik-stdout> <plik-stderr>` — drukuje JSON wyniku na stdout.
// Cienka warstwa I/O wokół `classifyAuditResult`, wywoływana przez `scripts/sca-audit.sh`.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { readFileSync } = await import('node:fs');
  const [, , stdoutPath, stderrPath] = process.argv;
  const stdout = readFileSync(stdoutPath, 'utf8');
  const stderr = readFileSync(stderrPath, 'utf8');
  process.stdout.write(JSON.stringify(classifyAuditResult({ stdout, stderr })));
}
