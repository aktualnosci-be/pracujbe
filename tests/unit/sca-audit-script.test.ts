import { execFileSync } from 'node:child_process';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * #607 — test end-to-end de `scripts/sca-audit.sh` z podstawionym `npm` na PATH (bez sieci,
 * bez prawdziwego audytu). Uzupełnia unit testy `classifyAuditResult` o pętlę ponowień i kody
 * wyjścia skryptu bash, których nie widać z samej funkcji klasyfikującej.
 */

const SCRIPT = resolve(process.cwd(), 'scripts/sca-audit.sh');
let fakeBinDir: string | undefined;

function installFakeNpm(script: string): string {
  fakeBinDir = mkdtempSync(join(tmpdir(), 'sca-audit-fake-npm-'));
  const npmPath = join(fakeBinDir, 'npm');
  writeFileSync(npmPath, `#!/usr/bin/env bash\n${script}\n`);
  chmodSync(npmPath, 0o755);
  return fakeBinDir;
}

function runScript(env: Record<string, string> = {}): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT], {
      env: { ...process.env, PATH: `${fakeBinDir}:${process.env.PATH}`, ...env },
      encoding: 'utf8',
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const err = error as { status: number; stdout: string; stderr: string };
    return { status: err.status, stdout: err.stdout, stderr: err.stderr };
  }
}

afterEach(() => {
  if (fakeBinDir) rmSync(fakeBinDir, { recursive: true, force: true });
  fakeBinDir = undefined;
});

describe('scripts/sca-audit.sh (#607)', () => {
  it('kod 0 i "SCA OK" przy czystym audycie', () => {
    installFakeNpm('echo \'{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}\'');
    const result = runScript();
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SCA OK');
  });

  it('kod 1 przy realnych podatnościach high/critical', () => {
    installFakeNpm('echo \'{"metadata":{"vulnerabilities":{"high":1,"critical":1}}}\'; exit 1');
    const result = runScript();
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::');
    expect(result.stdout).toContain('podatności');
  });

  it('kod 1 BEZ ponowień przy pustym wyniku bez rozpoznanej przyczyny (kontrola ujemna #607: wcześniej kod 0)', () => {
    installFakeNpm('exit 1');
    const result = runScript({ SCA_AUDIT_MAX_ATTEMPTS: '3', SCA_AUDIT_RETRY_DELAY_SECONDS: '0' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::');
    expect(result.stdout).not.toContain('Próba');
  });

  it('kod 1 BEZ ponowień przy JSON pozbawionym metadata.vulnerabilities (kontrola ujemna #607: dawny "NOMETA")', () => {
    installFakeNpm('echo \'{"foo":"bar"}\'');
    const result = runScript({ SCA_AUDIT_RETRY_DELAY_SECONDS: '0' });
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('::error::');
  });

  it('ponawia rozpoznaną awarię przejściową do limitu prób, potem kod 0 z jawną decyzją', () => {
    installFakeNpm('echo "npm error code ENOTFOUND registry.npmjs.org" >&2; exit 1');
    const result = runScript({ SCA_AUDIT_MAX_ATTEMPTS: '3', SCA_AUDIT_RETRY_DELAY_SECONDS: '0' });
    expect(result.status).toBe(0);
    expect(result.stdout).toMatch(/Próba 1\/3/);
    expect(result.stdout).toMatch(/Próba 2\/3/);
    expect(result.stdout).toContain('DECYZJA: nie blokuję CI');
    expect(result.stdout).toContain('ENOTFOUND');
  });

  it('audyt czysty po pierwszej ponowionej próbie kończy się sukcesem bez blokowania', () => {
    fakeBinDir = mkdtempSync(join(tmpdir(), 'sca-audit-fake-npm-'));
    const npmPath = join(fakeBinDir, 'npm');
    const counterFile = join(fakeBinDir, 'attempts');
    writeFileSync(counterFile, '0');
    writeFileSync(
      npmPath,
      `#!/usr/bin/env bash\n` +
        `n=$(cat "${counterFile}"); n=$((n + 1)); echo "$n" > "${counterFile}"\n` +
        `if [ "$n" -lt 2 ]; then echo "npm error code ETIMEDOUT" >&2; exit 1; fi\n` +
        `echo '{"metadata":{"vulnerabilities":{"high":0,"critical":0}}}'\n`,
    );
    chmodSync(npmPath, 0o755);
    const result = runScript({ SCA_AUDIT_MAX_ATTEMPTS: '3', SCA_AUDIT_RETRY_DELAY_SECONDS: '0' });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('SCA OK');
    expect(result.stdout).toMatch(/Próba 1\/3/);
  });
});
