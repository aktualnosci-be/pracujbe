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
 * Odczytuje jedno pole `metadata.vulnerabilities.<severity>` zgodnie z kontraktem
 * `npm audit`: brakujące pole liczy się jako 0 (severity bez wpisów), ale KAŻDA
 * obecna wartość musi być nieujemną, skończoną liczbą całkowitą — inaczej nie mamy
 * wiarygodnego dowodu wyniku audytu (#643: `Number(value) || 0` maskowało tekst,
 * `NaN`, `Infinity` i liczby ujemne, zamieniając je cicho w zero).
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: number } | { ok: false }}
 */
function readVulnerabilityCount(value) {
  if (value === undefined || value === null) {
    return { ok: true, value: 0 };
  }
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return { ok: true, value };
  }
  return { ok: false };
}

const SEVERITIES = new Set(['info', 'low', 'moderate', 'high', 'critical']);
const BLOCKING = new Set(['high', 'critical']);
const GHSA_RE = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Wyjątek obowiązuje do końca dnia `expiresOn` (UTC) włącznie; potem porada znów blokuje.
 * Wpis o niepoprawnym kształcie nie zwalnia niczego (fail-closed).
 *
 * @param {unknown} exceptions
 * @param {Date} now
 * @returns {Array<{ advisory: string, package: string }>}
 */
export function activeExceptions(exceptions, now) {
  if (!Array.isArray(exceptions) || !(now instanceof Date) || Number.isNaN(now.getTime())) return [];
  const today = now.toISOString().slice(0, 10);
  return exceptions.filter(
    (e) =>
      e !== null &&
      typeof e === 'object' &&
      typeof e.advisory === 'string' &&
      GHSA_RE.test(e.advisory) &&
      typeof e.package === 'string' &&
      e.package.length > 0 &&
      typeof e.expiresOn === 'string' &&
      DATE_RE.test(e.expiresOn) &&
      typeof e.reason === 'string' &&
      e.reason.trim().length > 0 &&
      today <= e.expiresOn,
  );
}

/** Identyfikator GHSA porady z `npm audit` — tylko z adresu `https://github.com/advisories/GHSA-…`. */
function advisoryId(advisory) {
  const url = typeof advisory.url === 'string' ? advisory.url : '';
  const match = /^https:\/\/github\.com\/advisories\/(GHSA(?:-[23456789cfghjmpqrvwx]{4}){3})$/.exec(url);
  return match ? match[1] : null;
}

function isExcepted(advisory, active) {
  const id = advisoryId(advisory);
  if (!id) return false;
  return active.some((e) => e.advisory === id && advisory.name === e.package && advisory.dependency === e.package);
}

/**
 * Zbiera porady (obiekty w `via`), z których wynika wpis — idąc po nazwach pakietów
 * w `via` aż do porad. `null` = struktura spoza kontraktu (brak wpisu, zły typ).
 */
function collectAdvisories(map, name, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const entry = map[name];
  if (!entry || typeof entry !== 'object' || !Array.isArray(entry.via)) return null;
  const out = [];
  for (const cause of entry.via) {
    if (typeof cause === 'string') {
      const nested = collectAdvisories(map, cause, seen);
      if (nested === null) return null;
      out.push(...nested);
    } else if (cause !== null && typeof cause === 'object') {
      if (typeof cause.severity !== 'string' || !SEVERITIES.has(cause.severity)) return null;
      out.push(cause);
    } else {
      return null;
    }
  }
  return out;
}

function classifyFromAdvisories(map, metadataBlocking, exceptions, now) {
  const bad = (reason) => ({ status: 'unrecognized', reason });
  if (map === null || typeof map !== 'object' || Array.isArray(map)) {
    return bad('pole vulnerabilities spoza kontraktu npm audit (oczekiwano obiektu)');
  }
  const active = activeExceptions(exceptions, now);
  let high = 0;
  let critical = 0;
  let blockingEntries = 0;
  const excepted = new Set();
  for (const [name, entry] of Object.entries(map)) {
    if (!entry || typeof entry !== 'object' || typeof entry.severity !== 'string' || !SEVERITIES.has(entry.severity)) {
      return bad(`wpis vulnerabilities.${name} bez poprawnego severity`);
    }
    if (!BLOCKING.has(entry.severity)) continue;
    blockingEntries += 1;
    const advisories = collectAdvisories(map, name);
    if (advisories === null || advisories.length === 0) {
      return bad(`wpis vulnerabilities.${name} bez rozpoznawalnych porad w via`);
    }
    // Wpis jest pomijany tylko wtedy, gdy KAŻDA jego porada high/critical jest objęta
    // aktywnym wyjątkiem i jest co najmniej jedna taka porada.
    const blockingAdvisories = advisories.filter((a) => BLOCKING.has(a.severity));
    const uncovered = blockingAdvisories.filter((a) => !isExcepted(a, active));
    if (blockingAdvisories.length > 0 && uncovered.length === 0) {
      blockingAdvisories.forEach((a) => excepted.add(advisoryId(a)));
      continue;
    }
    if (entry.severity === 'critical') critical += 1;
    else high += 1;
  }
  // Sumy metadanych muszą zgadzać się z mapą — rozjazd = wynik niewiarygodny.
  if (blockingEntries !== metadataBlocking) {
    return bad(
      `metadata.vulnerabilities (high+critical=${metadataBlocking}) niezgodne z mapą vulnerabilities (${blockingEntries})`,
    );
  }
  return {
    status: high + critical > 0 ? 'vulnerable' : 'clean',
    high,
    critical,
    excepted: [...excepted].sort(),
  };
}

/**
 * @param {{ stdout: string, stderr: string }} result
 * @param {{ exceptions?: unknown, now?: Date }} [options] — wyjątki z
 *   `sca-audit-exceptions.json` i chwila porównywana z ich terminem (testy podają jawnie).
 * @returns {
 *   | { status: 'clean' | 'vulnerable', high: number, critical: number, excepted?: string[] }
 *   | { status: 'recognized_transient' | 'unrecognized', reason: string }
 * }
 */
export function classifyAuditResult({ stdout, stderr }, { exceptions = [], now = new Date() } = {}) {
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
    const high = readVulnerabilityCount(vulnerabilities.high);
    const critical = readVulnerabilityCount(vulnerabilities.critical);
    if (!high.ok || !critical.ok) {
      return {
        status: 'unrecognized',
        reason:
          'metadata.vulnerabilities.high/critical spoza kontraktu npm audit ' +
          '(oczekiwano nieujemnej liczby całkowitej albo braku pola)',
      };
    }
    // Wynik liczony z konkretnych porad (`vulnerabilities`/`via`), nie z sum metadanych —
    // tylko tak wyjątek dla jednej porady nie ukrywa żadnej innej. Bez mapy (stary/okrojony
    // format) zostają sumy metadanych, bez wyjątków (fail-closed).
    if (parsed.vulnerabilities !== undefined) {
      return classifyFromAdvisories(parsed.vulnerabilities, high.value + critical.value, exceptions, now);
    }
    return {
      status: high.value + critical.value > 0 ? 'vulnerable' : 'clean',
      high: high.value,
      critical: critical.value,
    };
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
  // Wyjątki są danymi (`sca-audit-exceptions.json`). Nieczytelny plik = brak wyjątków
  // (fail-closed: porada znów blokuje), nigdy cichy sukces.
  let exceptions = [];
  try {
    exceptions = JSON.parse(readFileSync(new URL('./sca-audit-exceptions.json', import.meta.url), 'utf8'));
  } catch {
    exceptions = [];
  }
  process.stdout.write(JSON.stringify(classifyAuditResult({ stdout, stderr }, { exceptions })));
}
