import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import prettier from 'prettier';

const workflows = ['ci.yml', 'delete-old-runs.yml'];
const sources = new Map();

for (const name of workflows) {
  const source = await readFile(new URL(`../.github/workflows/${name}`, import.meta.url), 'utf8');
  // Parser YAML Prettiera wykrywa błędną składnię obu workflowów.
  await prettier.format(source, { parser: 'yaml' });
  sources.set(name, source);

  const concurrency = source.match(/^concurrency:\s*\r?\n((?:^[ \t]+.*\r?\n)+)/m)?.[1];
  assert.ok(concurrency, `${name}: brak globalnej blokady przebiegu`);
  assert.match(concurrency, /^  group: pracujbe-shared-runner-workspace\s*$/m);
  assert.match(concurrency, /^  queue: max\s*$/m);
  assert.match(concurrency, /^  cancel-in-progress: false\s*$/m);
}

const ci = sources.get('ci.yml');
const jobsStart = ci.match(/^jobs:\s*\r?\n/m);
assert.ok(jobsStart, 'brak sekcji jobs');
const jobsSection = ci.slice(jobsStart.index + jobsStart[0].length);
const jobHeaders = [...jobsSection.matchAll(/^  ([a-z][a-z0-9_-]*):\s*\r?\n/gm)];
const jobs = jobHeaders.map((match, index) => [
  match[1],
  jobsSection.slice(match.index + match[0].length, jobHeaders[index + 1]?.index ?? jobsSection.length),
]);
const sequence = ['install', 'lint', 'typecheck', 'unit', 'sca', 'build', 'rls', 'migrations', 'e2e'];
assert.deepEqual(jobs.map(([name]) => name), sequence, 'zmieniono listę lub kolejność jobów CI');

for (let index = 0; index < jobs.length; index += 1) {
  const [name, body] = jobs[index];
  const dependencies = [...body.matchAll(/^    needs:\s*(.+?)\s*$/gm)].map((match) => match[1]);
  assert.deepEqual(dependencies, index ? [sequence[index - 1]] : [], `${name}: joby muszą tworzyć jedną liniową kolejkę bez cykli`);
  assert.match(body, /^    runs-on: \[self-hosted, linux, x64\]\s*$/m, `${name}: użyj tej samej puli runnerów`);
}

// Vitest ma startować z drzewa odtworzonego przez npm ci, także przy trafieniu
// cache. Sam cache node_modules może być niekompletny po pracy hosta.
const unit = jobs.find(([name]) => name === 'unit')?.[1];
assert.ok(unit, 'brak joba unit');
assert.match(unit, /^          cache: npm\s*$/m, 'unit: użyj cache pobrań npm');
assert.match(unit, /^        run: npm ci --prefer-offline --no-audit --fund=false\s*$/m, 'unit: npm ci musi uruchomić się zawsze');
assert.doesNotMatch(unit, /actions\/cache\/restore@v4/, 'unit: nie odtwarzaj node_modules');
assert.match(unit, /require\.resolve\('ms'\)/, 'unit: sprawdź zależność przed Vitest');

assert.match(sources.get('delete-old-runs.yml'), /^    runs-on: self-hosted\s*$/m);
console.log('CI i sprzątanie mają wspólną blokadę, a joby CI tworzą jedną kolejkę.');
