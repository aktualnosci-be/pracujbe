import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const MINIMUM_MAJORS = {
  'actions/checkout': 7,
  'actions/setup-node': 7,
  'actions/cache': 6,
  'actions/cache/restore': 6,
  'actions/upload-artifact': 7,
} as const;

type CoveredAction = keyof typeof MINIMUM_MAJORS;

function obsoleteCoveredActions(source: string): string[] {
  const references = source.matchAll(/uses:\s*(actions\/[\w-]+(?:\/[\w-]+)?)@v(\d+)/g);
  const obsolete: string[] = [];

  for (const [, action, majorText] of references) {
    if (!(action in MINIMUM_MAJORS)) continue;

    const coveredAction = action as CoveredAction;
    if (Number(majorText) < MINIMUM_MAJORS[coveredAction]) {
      obsolete.push(`${coveredAction}@v${majorText}`);
    }
  }

  return obsolete;
}

describe('oficjalne akcje GitHub używają runtime Node 24', () => {
  it('nie dopuszcza przestarzałego majora w żadnym workflow', () => {
    const workflowDirectory = resolve(process.cwd(), '.github', 'workflows');
    const workflowFiles = readdirSync(workflowDirectory).filter((file) => /\.ya?ml$/.test(file));
    const obsolete = workflowFiles.flatMap((file) =>
      obsoleteCoveredActions(readFileSync(resolve(workflowDirectory, file), 'utf8')).map(
        (reference) => `${file}: ${reference}`,
      ),
    );

    expect(obsolete).toEqual([]);
  });

  it('kontrola ujemna wykrywa poprzednie akcje oparte na Node 20', () => {
    const previousWorkflow = `
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - uses: actions/cache@v4
      - uses: actions/cache/restore@v4
      - uses: actions/upload-artifact@v4
    `;

    expect(obsoleteCoveredActions(previousWorkflow)).toEqual([
      'actions/checkout@v4',
      'actions/setup-node@v4',
      'actions/cache@v4',
      'actions/cache/restore@v4',
      'actions/upload-artifact@v4',
    ]);
  });
});
