// @vitest-environment node
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Linki względne w dokumentacji (#27, odbiór części dokumentacyjnej): README.md, CLAUDE.md
 * i docs/**.md. Link Markdown `[tekst](ścieżka)` do pliku w repozytorium musi wskazywać
 * istniejący plik lub katalog. Adresy http(s)/mailto i same kotwice (`#…`) są pomijane.
 */

const ROOT = process.cwd();

function markdownFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) markdownFiles(path, out);
    else if (name.endsWith('.md')) out.push(path);
  }
  return out;
}

/** Cele linków względnych w treści Markdown (bez bloków kodu). */
function relativeLinkTargets(markdown: string): string[] {
  const withoutCode = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  const targets: string[] = [];
  for (const match of withoutCode.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = match[1]!;
    if (/^(https?:|mailto:|#)/.test(raw)) continue;
    const path = raw.split('#')[0]!;
    if (path) targets.push(decodeURI(path));
  }
  return targets;
}

function brokenLinks(file: string): string[] {
  const text = readFileSync(file, 'utf-8');
  return relativeLinkTargets(text)
    .filter((target) => !existsSync(resolve(dirname(file), target)))
    .map((target) => `${relative(ROOT, file)} → ${target}`);
}

describe('linki względne w dokumentacji', () => {
  const files = [join(ROOT, 'README.md'), join(ROOT, 'CLAUDE.md'), ...markdownFiles(join(ROOT, 'docs'))];

  it('każdy link względny wskazuje istniejący plik', () => {
    expect(files.length).toBeGreaterThan(20);
    expect(files.flatMap(brokenLinks)).toEqual([]);
  });

  it('kontrola ujemna: nieistniejący cel jest wykrywany, adresy zewnętrzne i kotwice nie', () => {
    const sample = [
      '[ok](./README.md)',
      '[brak](./NIE_ISTNIEJE.md#sekcja)',
      '[www](https://example.com)',
      '[kotwica](#sekcja)',
      '`[w kodzie](./tez-nie.md)`',
    ].join('\n');
    expect(relativeLinkTargets(sample)).toEqual(['./README.md', './NIE_ISTNIEJE.md']);
    const missing = relativeLinkTargets(sample).filter((t) => !existsSync(resolve(ROOT, t)));
    expect(missing).toEqual(['./NIE_ISTNIEJE.md']);
  });
});
