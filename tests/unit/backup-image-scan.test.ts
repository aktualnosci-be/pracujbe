// @vitest-environment node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  checkSbom,
  classifyBackupImageScan,
  parseExceptions,
  readTrivyReport,
} from '../../scripts/lib/backup-image-scan-outcome.mjs';

/**
 * #751: bramka skanu obrazu kopii bazy. Blokują HIGH/CRITICAL z dostępną poprawką (bez ważnego
 * wyjątku); raport bez pakietów, zły SBOM albo zły plik wyjątków = wynik nierozpoznany (kod 2),
 * nigdy „czysto”.
 */
const TODAY = '2026-10-01';

type Vuln = { VulnerabilityID: string; PkgName: string; Severity: string; FixedVersion?: string };

function report(osVulns: Vuln[] = [], nodeVulns: Vuln[] = []) {
  return {
    SchemaVersion: 2,
    ArtifactName: 'pracujbe-backup:ci',
    Results: [
      {
        Target: 'pracujbe-backup:ci (debian 12.15)',
        Class: 'os-pkgs',
        Type: 'debian',
        Packages: [{ Name: 'age' }, { Name: 'postgresql-client-18' }],
        Vulnerabilities: osVulns,
      },
      { Target: 'Node.js', Class: 'lang-pkgs', Type: 'node-pkg', Packages: [{ Name: '@aws-sdk/client-s3' }], Vulnerabilities: nodeVulns },
    ],
  };
}

const SBOM = {
  bomFormat: 'CycloneDX',
  specVersion: '1.6',
  components: [
    { name: 'age', purl: 'pkg:deb/debian/age@1.1.1-1%2Bb5?arch=amd64&distro=debian-12.15' },
    { name: 'postgresql-client-18', purl: 'pkg:deb/debian/postgresql-client-18@18.4-1.pgdg120%2B1?arch=amd64' },
    { name: '@aws-sdk/client-s3', purl: 'pkg:npm/%40aws-sdk/client-s3@3.1137.0' },
  ],
};
const NO_EXCEPTIONS = { exceptions: [] };
const fixable: Vuln = { VulnerabilityID: 'CVE-2026-1', PkgName: 'libssl3', Severity: 'HIGH', FixedVersion: '3.0.23-1~deb12u1' };

describe('classifyBackupImageScan', () => {
  it('raport z pakietami, bez podatności z poprawką = clean (podatności bez poprawki tylko liczone)', () => {
    const result = classifyBackupImageScan({
      report: report([
        { VulnerabilityID: 'CVE-2026-2', PkgName: 'curl', Severity: 'CRITICAL' },
        { VulnerabilityID: 'CVE-2026-3', PkgName: 'curl', Severity: 'MEDIUM', FixedVersion: '1.2' },
      ]),
      sbom: SBOM,
      exceptions: NO_EXCEPTIONS,
      today: TODAY,
    });
    expect(result).toMatchObject({ outcome: 'clean', osPackages: 2, nodePackages: 1, unfixedHighCritical: 1, blocking: [] });
  });

  it.each(['HIGH', 'CRITICAL'])('kontrola ujemna: %s z dostępną poprawką blokuje (Debian i Node)', (severity) => {
    for (const [os, node] of [[[{ ...fixable, Severity: severity }], []], [[], [{ ...fixable, PkgName: 'brace-expansion', Severity: severity }]]]) {
      const result = classifyBackupImageScan({ report: report(os, node), sbom: SBOM, exceptions: NO_EXCEPTIONS, today: TODAY });
      expect(result.outcome).toBe('vulnerable');
      expect(result.blocking).toHaveLength(1);
    }
  });

  it('ważny wyjątek przepuszcza, wygasły znów blokuje', () => {
    const entry = { id: 'CVE-2026-1', package: 'libssl3', reason: 'poprawka w kolejnym digeście', expires: '2026-10-15' };
    const ok = classifyBackupImageScan({ report: report([fixable]), sbom: SBOM, exceptions: { exceptions: [entry] }, today: TODAY });
    expect(ok).toMatchObject({ outcome: 'clean', excepted: [{ id: 'CVE-2026-1', expires: '2026-10-15' }] });
    const expired = classifyBackupImageScan({ report: report([fixable]), sbom: SBOM, exceptions: { exceptions: [entry] }, today: '2026-10-16' });
    expect(expired.outcome).toBe('vulnerable');
    expect(expired.expiredExceptions).toHaveLength(1);
    // Wyjątek dla innego pakietu nie obejmuje tej samej podatności.
    const other = classifyBackupImageScan({ report: report([fixable]), sbom: SBOM, exceptions: { exceptions: [{ ...entry, package: 'openssl' }] }, today: TODAY });
    expect(other.outcome).toBe('vulnerable');
  });

  it.each([
    ['pusty obiekt', {}],
    ['zła wersja schematu', { ...report(), SchemaVersion: 1 }],
    ['bez pakietów systemowych (brak --list-all-pkgs)', { ...report(), Results: report().Results.map((r) => ({ ...r, Packages: undefined })) }],
    ['bez pakietów Node', { ...report(), Results: [report().Results[0]] }],
    ['podatność bez identyfikatora', report([{ ...fixable, VulnerabilityID: '' }])],
    ['nieznana waga', report([{ ...fixable, Severity: 'SEVERE' }])],
  ])('kontrola ujemna: raport %s = unrecognized (nie „czysto”)', (_name, bad) => {
    const result = classifyBackupImageScan({ report: bad, sbom: SBOM, exceptions: NO_EXCEPTIONS, today: TODAY });
    expect(result.outcome).toBe('unrecognized');
  });

  it.each([
    ['inny format', { ...SBOM, bomFormat: 'SPDX' }],
    ['bez klienta PostgreSQL', { ...SBOM, components: SBOM.components.filter((c) => c.name !== 'postgresql-client-18') }],
    ['bez age', { ...SBOM, components: SBOM.components.filter((c) => c.name !== 'age') }],
    ['bez SDK S3', { ...SBOM, components: SBOM.components.filter((c) => c.name !== '@aws-sdk/client-s3') }],
  ])('kontrola ujemna: SBOM %s = unrecognized', (_name, sbom) => {
    expect(checkSbom(sbom).ok).toBe(false);
    expect(classifyBackupImageScan({ report: report(), sbom, exceptions: NO_EXCEPTIONS, today: TODAY }).outcome).toBe('unrecognized');
  });

  it.each([
    ['bez tablicy', {}],
    ['bez powodu', { exceptions: [{ id: 'CVE-1', package: 'x', expires: '2026-10-10' }] }],
    ['bez terminu', { exceptions: [{ id: 'CVE-1', package: 'x', reason: 'r' }] }],
    ['termin ponad 90 dni', { exceptions: [{ id: 'CVE-1', package: 'x', reason: 'r', expires: '2027-06-01' }] }],
  ])('kontrola ujemna: plik wyjątków %s = unrecognized', (_name, exceptions) => {
    expect(parseExceptions(exceptions, TODAY).ok).toBe(false);
    expect(classifyBackupImageScan({ report: report(), sbom: SBOM, exceptions, today: TODAY }).outcome).toBe('unrecognized');
  });

  it('repozytoryjny plik wyjątków jest poprawny', () => {
    const raw = JSON.parse(readFileSync('docker/backup/vulnerability-exceptions.json', 'utf8'));
    expect(parseExceptions(raw, TODAY).ok).toBe(true);
  });

  it('readTrivyReport liczy pakiety z obu klas', () => {
    expect(readTrivyReport(report())).toMatchObject({ ok: true, osPackages: 2, nodePackages: 1 });
  });
});

describe('scripts/security/backup-image-scan.mjs (CLI)', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  function run(scan: unknown, sbom: unknown = SBOM) {
    const dir = mkdtempSync(join(tmpdir(), 'backup-scan-'));
    dirs.push(dir);
    const files = { report: join(dir, 'scan.json'), sbom: join(dir, 'sbom.json'), summary: join(dir, 'summary.md') };
    writeFileSync(files.report, typeof scan === 'string' ? scan : JSON.stringify(scan));
    writeFileSync(files.sbom, JSON.stringify(sbom));
    const result = spawnSync(
      process.execPath,
      ['scripts/security/backup-image-scan.mjs', '--report', files.report, '--sbom', files.sbom, '--summary', files.summary, '--today', TODAY],
      { encoding: 'utf8' },
    );
    return { code: result.status, output: result.stdout + result.stderr, summary: readFileSync(files.summary, 'utf8') };
  }

  it('czysty skan = 0 i podsumowanie w pliku', () => {
    const { code, summary } = run(report());
    expect(code).toBe(0);
    expect(summary).toContain('Brak podatności blokujących');
  });

  it('kontrola ujemna: podatność blokująca = 1 z identyfikatorem w podsumowaniu', () => {
    const { code, summary } = run(report([fixable]));
    expect(code).toBe(1);
    expect(summary).toContain('CVE-2026-1 libssl3');
  });

  it('kontrola ujemna: uszkodzony raport (awaria skanera) = 2, nie 0', () => {
    const { code, output } = run('');
    expect(code).toBe(2);
    expect(output).toContain('Wynik nierozpoznany');
  });
});
