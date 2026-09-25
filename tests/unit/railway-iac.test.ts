import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Strażnik Railway IaC (#19): `.railway/railway.ts` parsuje się, zarządza tylko usługami
 * z tego repo (named partial), nie zawiera wartości zmiennych ani sekretów, a komendy
 * i healthcheck wskazują istniejące skrypty/trasy. Plik jest wykonywany z atrapą
 * `railway/iac` — bez pakietu `railway` i bez dostępu do Railway.
 */

const ROOT = resolve(__dirname, '../..');
const IAC_PATH = resolve(ROOT, '.railway/railway.ts');
const PRESERVE = Symbol('preserve');

type ServiceConfig = Record<string, unknown> & {
  source?: { repo: string; branch?: string };
  build?: string;
  start?: string;
  healthcheck?: string;
  deploy?: Record<string, unknown>;
  env?: Record<string, unknown>;
};
type Service = { kind: 'service'; name: string; config: ServiceConfig };
type Evaluated = { partial: unknown; project: { name: string; resources: Service[] } };

function evaluate(source: string): Evaluated {
  const { outputText, diagnostics } = ts.transpileModule(source, {
    reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  if (diagnostics?.length) {
    throw new Error(ts.flattenDiagnosticMessageText(diagnostics[0]!.messageText, '\n'));
  }
  const iac = {
    defineRailway: (fn: (ctx: unknown) => unknown) => fn,
    github: (repo: string, opts: Record<string, unknown> = {}) => ({ repo, ...opts }),
    preserve: () => PRESERVE,
    project: (name: string, opts: { resources: Service[] }) => ({ name, ...opts }),
    service: (name: string, config: ServiceConfig = {}): Service => ({ kind: 'service', name, config }),
  };
  const mod: { exports: Record<string, unknown> } = { exports: {} };
  const req = (id: string) => {
    if (id === 'railway/iac') return iac;
    throw new Error(`niedozwolony import w .railway/railway.ts: ${id}`);
  };
  new Function('require', 'module', 'exports', outputText)(req, mod, mod.exports);
  const define = mod.exports.default as (ctx: unknown) => Evaluated['project'];
  return {
    partial: mod.exports.partial,
    project: define({ environment: 'production', command: 'plan' }),
  };
}

/** Zwraca listę naruszeń; pusta = plik spełnia kontrakt. */
function violations(source: string): string[] {
  const out: string[] = [];
  let evaluated: Evaluated;
  try {
    evaluated = evaluate(source);
  } catch (error) {
    return [`nie da się wykonać: ${(error as Error).message}`];
  }
  if (typeof evaluated.partial !== 'string' || !evaluated.partial) {
    out.push('brak `export const partial` — pełny plik projektu usunąłby bazę i bucket');
  }
  const names = evaluated.project.resources.map((r) => r.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(['db-migrator', 'pracujbe'])) {
    out.push(`nieoczekiwane zasoby: ${names.join(', ')}`);
  }
  const scripts = (JSON.parse(readFileSync(resolve(ROOT, 'package.json'), 'utf8')) as {
    scripts: Record<string, string>;
  }).scripts;
  for (const { name, config } of evaluated.project.resources) {
    if (config.source?.repo !== 'aktualnosci-be/pracujbe' || config.source.branch !== 'main') {
      out.push(`${name}: źródło inne niż aktualnosci-be/pracujbe@main`);
    }
    for (const [key, value] of Object.entries(config.env ?? {})) {
      if (value !== PRESERVE) out.push(`${name}: zmienna ${key} ma wartość w repo (tylko preserve())`);
    }
    for (const command of [config.build, config.start]) {
      const script = command?.match(/^npm run ([\w:.-]+)$/)?.[1];
      if (script && !scripts[script]) out.push(`${name}: brak skryptu npm "${script}"`);
    }
  }
  const web = evaluated.project.resources.find((r) => r.name === 'pracujbe');
  if (web) {
    if (web.config.healthcheck !== '/api/health') out.push('pracujbe: healthcheck inny niż /api/health');
    if (!existsSync(resolve(ROOT, 'src/app/api/health/route.ts'))) out.push('brak trasy /api/health');
  }
  const migrator = evaluated.project.resources.find((r) => r.name === 'db-migrator');
  if (migrator) {
    if (migrator.config.deploy?.restartPolicyType !== 'NEVER') out.push('db-migrator: restart inny niż NEVER');
    if (migrator.config.start !== 'npm run db:migrate:production') out.push('db-migrator: zła komenda start');
    if (migrator.config.healthcheck) out.push('db-migrator: jednorazowy proces nie ma healthchecku');
  }
  if (web?.config.env && 'MIGRATION_DATABASE_URL' in web.config.env) {
    out.push('pracujbe: login migratora w usłudze web');
  }
  // Wzorce wartości sekretów/połączeń — niezależnie od miejsca w pliku (także komentarze).
  const secretPatterns: [RegExp, string][] = [
    [/postgres(?:ql)?:\/\/\S+/i, 'URL połączenia PostgreSQL'],
    [/\b(?:sk|pk|rk)_(?:live|test)_\w+/, 'klucz Stripe'],
    [/\bwhsec_\w+/, 'sekret webhooka'],
    [/\bre_[A-Za-z0-9]{16,}/, 'klucz Resend'],
    [/\bAKIA[0-9A-Z]{16}\b/, 'klucz AWS'],
    [/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
    [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'klucz prywatny'],
    [/\$\{\{/, 'referencja zmiennej Railway (wartość należy do Railway)'],
    [/\bRAILWAY_TOKEN\s*[:=]/, 'token Railway'],
  ];
  for (const [pattern, label] of secretPatterns) {
    if (pattern.test(source)) out.push(`wygląda na sekret/wartość: ${label}`);
  }
  return out;
}

describe('.railway/railway.ts (Railway IaC, #19)', () => {
  const source = readFileSync(IAC_PATH, 'utf8');

  it('spełnia kontrakt: partial, komendy, healthcheck, restart NEVER, bez wartości zmiennych', () => {
    expect(violations(source)).toEqual([]);
  });

  it('nie ma Config as Code (railway.json/toml), który Railway czytałby przy deployu', () => {
    for (const file of ['railway.json', 'railway.toml']) {
      expect(existsSync(resolve(ROOT, file)), file).toBe(false);
    }
  });

  it('pole start usługi web zostaje puste, jak w Railway (domyślne npm start Railpacka)', () => {
    const web = evaluate(source).project.resources.find((r) => r.name === 'pracujbe');
    expect(web?.config.start).toBeUndefined();
  });

  describe('kontrola ujemna — strażnik odrzuca', () => {
    const cases: [string, (s: string) => string, RegExp][] = [
      ['literalną wartość zmiennej', (s) => s.replace("MIGRATION_MODE: preserve()", "MIGRATION_MODE: 'apply'"), /MIGRATION_MODE ma wartość/],
      ['URL bazy w pliku', (s) => s.replace("CHECK_APP_URL: preserve()", "CHECK_APP_URL: 'postgresql://u:p@h/db'"), /PostgreSQL/],
      ['referencję ${{…}}', (s) => s.replace("DB_LOGIN_STEP: preserve()", "DB_LOGIN_STEP: '${{shared.X}}'"), /referencja/],
      ['brak partial', (s) => s.replace("export const partial = 'pracujbe-repo';", ''), /partial/],
      ['restart inny niż NEVER', (s) => s.replace("restartPolicyType: 'NEVER'", "restartPolicyType: 'ON_FAILURE'"), /NEVER/],
      ['inny healthcheck', (s) => s.replace("'/api/health'", "'/health'"), /healthcheck/],
      ['nieistniejący skrypt npm', (s) => s.replace('npm run db:migrate:production', 'npm run db:migrate:prod'), /brak skryptu|zła komenda/],
      ['login migratora w web', (s) => s.replace('BETTER_AUTH_SECRET: preserve(),', 'BETTER_AUTH_SECRET: preserve(), MIGRATION_DATABASE_URL: preserve(),'), /login migratora/],
      ['bazę w zasobach', (s) => s.replace('resources: [web, migrator]', "resources: [web, migrator, service('PostgreSQL 18')]"), /nieoczekiwane zasoby/],
      ['błąd składni', (s) => s.replace('export default defineRailway(() => {', 'export default defineRailway(() => {{'), /nie da się wykonać/],
      ['obcy import', (s) => `import 'node:fs';\n${s}`, /niedozwolony import/],
    ];
    it.each(cases)('%s', (_label, mutate, expected) => {
      const mutated = mutate(source);
      expect(mutated).not.toBe(source);
      expect(violations(mutated).join('\n')).toMatch(expected);
    });
  });
});
