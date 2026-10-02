/**
 * Klasyfikacja skanu obrazu kopii bazy (#751): raport Trivy (`--format json --list-all-pkgs`)
 * i SBOM CycloneDX tego samego obrazu.
 *
 * Wynik:
 * - `clean` — skan policzony (pakiety systemowe Debiana ORAZ pakiety Node w raporcie), SBOM
 *   kompletny, brak podatności blokujących;
 * - `vulnerable` — podatność HIGH/CRITICAL, dla której istnieje poprawka (`FixedVersion`),
 *   bez ważnego wyjątku — albo wyjątek wygasły;
 * - `unrecognized` — raport/SBOM pusty, niepełny albo o nieznanym kształcie, zły plik wyjątków.
 *   Awaria skanera nie może wyglądać jak „brak podatności”.
 *
 * Próg: blokują HIGH i CRITICAL z dostępną poprawką (jak bramka SCA aplikacji: high/critical).
 * Podatności bez poprawki w dystrybucji są raportowane w podsumowaniu, ale nie blokują —
 * nie ma czego zaktualizować. Wyjątek = jawny wpis z identyfikatorem, pakietem, powodem
 * i terminem (najwyżej MAX_EXCEPTION_DAYS dni od dziś); po terminie podatność znów blokuje.
 *
 * Bez I/O — testowalne na sztucznych danych (tests/unit/backup-image-scan.test.ts).
 */

export const BLOCKING_SEVERITIES = new Set(['CRITICAL', 'HIGH']);
const KNOWN_SEVERITIES = new Set(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN']);
export const MAX_EXCEPTION_DAYS = 90;

/** Pakiety, bez których obraz nie wykona kopii — muszą być w SBOM (dowód, że SBOM obejmuje obraz). */
export const REQUIRED_SBOM_PACKAGES = [
  { type: 'deb', name: 'age' },
  { type: 'deb', namePattern: /^postgresql-client-\d+$/ },
  { type: 'npm', name: '@aws-sdk/client-s3' },
];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmptyString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * @param {unknown} raw — zawartość pliku wyjątków (JSON)
 * @param {string} today — `YYYY-MM-DD` (UTC)
 * @returns {{ ok: true, exceptions: Array<{ id: string, package: string, reason: string, expires: string, expired: boolean }> } | { ok: false, reason: string }}
 */
export function parseExceptions(raw, today) {
  if (!isObject(raw) || !Array.isArray(raw.exceptions)) {
    return { ok: false, reason: 'plik wyjątków musi mieć tablicę `exceptions`' };
  }
  const limit = addDays(today, MAX_EXCEPTION_DAYS);
  const exceptions = [];
  for (const [index, entry] of raw.exceptions.entries()) {
    if (!isObject(entry) || !nonEmptyString(entry.id) || !nonEmptyString(entry.package) || !nonEmptyString(entry.reason)) {
      return { ok: false, reason: `wyjątek #${index + 1}: wymagane id, package i reason` };
    }
    if (typeof entry.expires !== 'string' || !DATE_RE.test(entry.expires) || Number.isNaN(Date.parse(entry.expires))) {
      return { ok: false, reason: `wyjątek ${entry.id}: wymagany termin expires (YYYY-MM-DD)` };
    }
    if (entry.expires > limit) {
      return { ok: false, reason: `wyjątek ${entry.id}: termin dalej niż ${MAX_EXCEPTION_DAYS} dni (${limit})` };
    }
    exceptions.push({ id: entry.id, package: entry.package, reason: entry.reason, expires: entry.expires, expired: entry.expires < today });
  }
  return { ok: true, exceptions };
}

function addDays(day, days) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * @param {unknown} report — raport Trivy JSON (SchemaVersion 2)
 * @returns {{ ok: true, osPackages: number, nodePackages: number, vulnerabilities: Array<{ id: string, pkg: string, severity: string, fixed: string | null, target: string }> } | { ok: false, reason: string }}
 */
export function readTrivyReport(report) {
  if (!isObject(report) || report.SchemaVersion !== 2 || !Array.isArray(report.Results)) {
    return { ok: false, reason: 'raport skanu nie jest raportem Trivy (SchemaVersion 2, Results)' };
  }
  let osPackages = 0;
  let nodePackages = 0;
  const vulnerabilities = [];
  for (const result of report.Results) {
    if (!isObject(result) || !nonEmptyString(result.Target)) return { ok: false, reason: 'wynik skanu bez Target' };
    const packages = result.Packages ?? [];
    const found = result.Vulnerabilities ?? [];
    if (!Array.isArray(packages) || !Array.isArray(found)) return { ok: false, reason: `${result.Target}: Packages/Vulnerabilities nie są tablicami` };
    if (result.Class === 'os-pkgs' && result.Type === 'debian') osPackages += packages.length;
    if (result.Class === 'lang-pkgs' && result.Type === 'node-pkg') nodePackages += packages.length;
    for (const vuln of found) {
      if (!isObject(vuln) || !nonEmptyString(vuln.VulnerabilityID) || !nonEmptyString(vuln.PkgName) || !KNOWN_SEVERITIES.has(vuln.Severity)) {
        return { ok: false, reason: `${result.Target}: podatność o nieznanym kształcie` };
      }
      vulnerabilities.push({
        id: vuln.VulnerabilityID,
        pkg: vuln.PkgName,
        severity: vuln.Severity,
        fixed: nonEmptyString(vuln.FixedVersion) ? vuln.FixedVersion : null,
        target: result.Target,
      });
    }
  }
  // Bez listy pakietów nie ma dowodu, że skan objął obraz (np. zła opcja albo pusty obraz).
  if (osPackages === 0) return { ok: false, reason: 'raport bez pakietów systemowych Debiana (uruchom z --list-all-pkgs)' };
  if (nodePackages === 0) return { ok: false, reason: 'raport bez pakietów Node (oczekiwany @aws-sdk/client-s3)' };
  return { ok: true, osPackages, nodePackages, vulnerabilities };
}

/**
 * @param {unknown} sbom — CycloneDX JSON
 * @returns {{ ok: true, components: number } | { ok: false, reason: string }}
 */
export function checkSbom(sbom) {
  if (!isObject(sbom) || sbom.bomFormat !== 'CycloneDX' || !Array.isArray(sbom.components)) {
    return { ok: false, reason: 'SBOM nie jest dokumentem CycloneDX z listą components' };
  }
  const purls = sbom.components.map((component) => (isObject(component) && typeof component.purl === 'string' ? component.purl : ''));
  for (const required of REQUIRED_SBOM_PACKAGES) {
    const present = purls.some((purl) => {
      const parsed = parsePurl(purl);
      if (!parsed || parsed.type !== required.type) return false;
      return required.name ? parsed.name === required.name : required.namePattern.test(parsed.name);
    });
    if (!present) return { ok: false, reason: `SBOM bez pakietu ${required.type}:${required.name ?? required.namePattern.source}` };
  }
  return { ok: true, components: sbom.components.length };
}

function parsePurl(purl) {
  const match = /^pkg:([a-z]+)\/(.+?)(?:@[^/]*)?(?:\?.*)?$/.exec(purl);
  if (!match) return null;
  const path = decodeURIComponent(match[2]).split('/');
  // pkg:deb/debian/<nazwa>, pkg:npm/<nazwa> albo pkg:npm/%40scope/<nazwa>
  const name = match[1] === 'deb' ? path.slice(1).join('/') : path.join('/');
  return { type: match[1], name };
}

/**
 * @param {{ report: unknown, sbom: unknown, exceptions: unknown, today: string }} input
 */
export function classifyBackupImageScan({ report, sbom, exceptions, today }) {
  const parsedExceptions = parseExceptions(exceptions, today);
  if (!parsedExceptions.ok) return { outcome: 'unrecognized', reason: parsedExceptions.reason };
  const scan = readTrivyReport(report);
  if (!scan.ok) return { outcome: 'unrecognized', reason: scan.reason };
  const bom = checkSbom(sbom);
  if (!bom.ok) return { outcome: 'unrecognized', reason: bom.reason };

  const blocking = [];
  const excepted = [];
  const expiredExceptions = [];
  let unfixedHighCritical = 0;
  const seen = new Set();
  for (const vuln of scan.vulnerabilities) {
    if (!BLOCKING_SEVERITIES.has(vuln.severity)) continue;
    if (!vuln.fixed) {
      unfixedHighCritical += 1;
      continue;
    }
    const key = `${vuln.id}|${vuln.pkg}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const exception = parsedExceptions.exceptions.find((entry) => entry.id === vuln.id && entry.package === vuln.pkg);
    if (exception && !exception.expired) excepted.push({ ...vuln, expires: exception.expires });
    else {
      blocking.push(vuln);
      if (exception) expiredExceptions.push(exception);
    }
  }
  return {
    outcome: blocking.length > 0 ? 'vulnerable' : 'clean',
    osPackages: scan.osPackages,
    nodePackages: scan.nodePackages,
    sbomComponents: bom.components,
    blocking,
    excepted,
    expiredExceptions,
    unfixedHighCritical,
  };
}
