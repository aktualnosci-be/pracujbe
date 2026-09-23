import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

// Strażnik workflowów CI na GitHub-hosted runnerach (pula minut Actions).
// Pilnuje nazw jobów (wymagane checki i Railway `Wait for CI`), limitów czasu,
// kolejności drogich jobów i tego, że przebiegi main nigdy nie są anulowane.

const workflows = ['ci.yml', 'delete-old-runs.yml'];
const sources = new Map();

for (const name of workflows) {
  const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
  // Parser YAML Prettiera wykrywa błędną składnię obu workflowów.
  await prettier.format(source, { parser: 'yaml' });
  sources.set(name, source);
  assert.ok(!/^\s*runs-on:.*self-hosted/m.test(source), `${name}: CI działa na ubuntu-latest, nie na self-hosted`);
}

const ci = sources.get('ci.yml');
const concurrency = ci.match(/^concurrency:\s*\r?\n((?:^[ \t]+.*\r?\n)+)/m)?.[1];
assert.ok(concurrency, 'ci.yml: brak blokady concurrency');
assert.match(concurrency, /format\('pr-\{0\}', github\.event\.pull_request\.number\) \|\| github\.sha/, 'ci.yml: grupa per PR, a dla main per SHA');
assert.match(concurrency, /^  cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}\s*$/m, 'ci.yml: anuluj tylko nieaktualne przebiegi PR, nigdy main');

const jobsStart = ci.match(/^jobs:\s*\r?\n/m);
assert.ok(jobsStart, 'brak sekcji jobs');
const jobsSection = ci.slice(jobsStart.index + jobsStart[0].length);
const jobHeaders = [...jobsSection.matchAll(/^  ([a-z][a-z0-9_-]*):\s*\r?\n/gm)];
const jobs = new Map(
  jobHeaders.map((match, index) => [
    match[1],
    jobsSection.slice(match.index + match[0].length, jobHeaders[index + 1]?.index ?? jobsSection.length),
  ]),
);

// Nazwy wyświetlane są wymaganymi checkami — ich zmiana blokuje scalanie i wdrożenie.
const expected = {
  install: ['Install & cache deps', []],
  lint: ['Lint', ['install']],
  typecheck: ['Typecheck', ['install']],
  unit: ['Unit tests (Vitest)', ['install']],
  sca: ['SCA (npm audit)', []],
  build: ['Build (Next.js)', ['lint', 'typecheck', 'unit']],
  rls: ['RLS integration (PostgreSQL 16)', []],
  migrations: ['Migration runner (PostgreSQL 16)', ['install']],
  e2e: ['E2E (Playwright)', ['build']],
};
assert.deepEqual([...jobs.keys()], Object.keys(expected), 'zmieniono listę lub kolejność jobów CI');

for (const [name, body] of jobs) {
  const [title, needs] = expected[name];
  assert.match(body, new RegExp(`^    name: ${title.replace(/[()&]/g, '\\$&')}\\s*$`, 'm'), `${name}: nazwa checka musi zostać „${title}”`);
  const declared = body.match(/^    needs:\s*(.+?)\s*$/m)?.[1];
  const parsed = declared ? declared.replace(/^\[|\]$/g, '').split(',').map((item) => item.trim()) : [];
  assert.deepEqual(parsed, needs, `${name}: nieoczekiwane zależności jobu`);
  assert.match(body, /^    runs-on: ubuntu-latest\s*$/m, `${name}: użyj ubuntu-latest`);
  const timeout = Number(body.match(/^    timeout-minutes:\s*(\d+)\s*$/m)?.[1]);
  assert.ok(timeout > 0 && timeout <= 30, `${name}: ustaw timeout-minutes (1–30), żeby nie zjadać puli minut`);
}

// Vitest ma startować z drzewa odtworzonego przez npm ci, także przy trafieniu
// cache. Sam cache node_modules bywa niekompletny.
const unit = jobs.get('unit');
assert.match(unit, /^          cache: npm\s*$/m, 'unit: użyj cache pobrań npm');
assert.match(unit, /^        run: npm ci --prefer-offline --no-audit --fund=false\s*$/m, 'unit: npm ci musi uruchomić się zawsze');
assert.doesNotMatch(unit, /actions\/cache\/restore@v4/, 'unit: nie odtwarzaj node_modules');
assert.match(unit, /require\.resolve\('ms'\)/, 'unit: sprawdź zależność przed Vitest');

assert.match(jobs.get('e2e'), /npx playwright install --with-deps chromium/, 'e2e: hostowany runner potrzebuje przeglądarki i bibliotek systemowych');

const cleanup = sources.get('delete-old-runs.yml');
assert.match(cleanup, /^    runs-on: ubuntu-latest\s*$/m);
assert.match(cleanup, /^    timeout-minutes: \d+\s*$/m);
console.log('Workflowy CI: ubuntu-latest, limity czasu, stałe nazwy checków, main bez anulowania.');
