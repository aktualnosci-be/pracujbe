#!/usr/bin/env node
// Bramka skanu obrazu kopii bazy (#751) — job CI „Backup image (build + scan)”.
// Czyta raport Trivy (JSON, --list-all-pkgs), SBOM CycloneDX i plik wyjątków, klasyfikuje
// wynik (scripts/lib/backup-image-scan-outcome.mjs) i wypisuje podsumowanie (także do
// $GITHUB_STEP_SUMMARY, gdy podano --summary).
//
// Użycie: node scripts/security/backup-image-scan.mjs --report scan.json --sbom sbom.cdx.json \
//           [--exceptions docker/backup/vulnerability-exceptions.json] [--summary plik] [--today YYYY-MM-DD]
// Kod wyjścia: 0 = clean; 1 = podatności blokujące; 2 = raport/SBOM/wyjątki nierozpoznane
// (awaria skanera nie udaje wyniku „brak podatności”).
import { appendFileSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import { classifyBackupImageScan } from '../lib/backup-image-scan-outcome.mjs';

const { values } = parseArgs({
  options: {
    report: { type: 'string' },
    sbom: { type: 'string' },
    exceptions: { type: 'string', default: 'docker/backup/vulnerability-exceptions.json' },
    summary: { type: 'string' },
    today: { type: 'string' },
  },
});

function readJson(path, label) {
  if (!path) return { error: `brak ścieżki ${label}` };
  try {
    return { value: JSON.parse(readFileSync(path, 'utf8')) };
  } catch {
    return { error: `nie można odczytać ${label} (${path})` };
  }
}

const today = values.today ?? new Date().toISOString().slice(0, 10);
const inputs = {
  report: readJson(values.report, 'raportu skanu'),
  sbom: readJson(values.sbom, 'SBOM'),
  exceptions: readJson(values.exceptions, 'pliku wyjątków'),
};
const readError = Object.values(inputs).find((input) => input.error)?.error;
const result = readError
  ? { outcome: 'unrecognized', reason: readError }
  : classifyBackupImageScan({ report: inputs.report.value, sbom: inputs.sbom.value, exceptions: inputs.exceptions.value, today });

const lines = ['### Obraz kopii bazy — skan pakietów (#751)', ''];
if (result.outcome === 'unrecognized') {
  lines.push(`**Wynik nierozpoznany:** ${result.reason}. Skan nie jest dowodem braku podatności.`);
} else {
  lines.push(
    `Pakiety: Debian ${result.osPackages}, Node ${result.nodePackages}; SBOM: ${result.sbomComponents} komponentów.`,
    `HIGH/CRITICAL bez poprawki w dystrybucji (raportowane, nie blokują): ${result.unfixedHighCritical}.`,
    `Wyjątki aktywne: ${result.excepted.length}; wygasłe: ${result.expiredExceptions.length}.`,
    '',
  );
  if (result.blocking.length === 0) lines.push('**Brak podatności blokujących** (HIGH/CRITICAL z dostępną poprawką).');
  else {
    lines.push(`**Podatności blokujące: ${result.blocking.length}** (HIGH/CRITICAL z dostępną poprawką):`, '');
    for (const vuln of result.blocking) lines.push(`- ${vuln.id} ${vuln.pkg} (${vuln.severity}) → ${vuln.fixed} — ${vuln.target}`);
    lines.push('', 'Zaktualizuj digest obrazu bazowego/zależność albo dodaj terminowy wyjątek w docker/backup/vulnerability-exceptions.json.');
  }
}
const text = `${lines.join('\n')}\n`;
process.stdout.write(text);
if (values.summary) appendFileSync(values.summary, text);

process.exit(result.outcome === 'clean' ? 0 : result.outcome === 'vulnerable' ? 1 : 2);
