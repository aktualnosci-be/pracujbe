import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { dirname, join, relative, resolve } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { CLIENT_MESSAGE_NAMESPACES, pickClientMessages } from '@/i18n/client-messages';
import pl from '@/messages/pl.json';

/**
 * Strażnik zawężenia wiadomości klienta (src/i18n/client-messages.ts).
 *
 * Graf klienta = pliki z dyrektywą 'use client' + wszystko, co importują (bez importów
 * `import type` i bez plików 'use server', które nie trafiają do bundla). W tym grafie:
 * - każda przestrzeń nazw z `useTranslations('ns' | 'ns.sub')` musi być na liście;
 * - dynamiczna przestrzeń nazw albo `useMessages()` = błąd (nie da się jej zawęzić);
 * - translator bez przestrzeni (`useTranslations()`) tłumaczy literały `ns.key` oraz klucze
 *   dynamiczne: `errors.*` i komunikaty walidacji `<ns>.error.<key>` — ich przestrzenie
 *   też muszą być na liście;
 * - lista nie zawiera przestrzeni, których klient nie używa.
 */

const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');
const VALIDATION_KEY = /^([a-z][A-Za-z]*)\.error\.[A-Za-z]+$/;

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !name.endsWith('.d.ts')) out.push(path);
  }
  return out;
}

function resolveImport(from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('@/')) base = join(SRC, spec.slice(2));
  else if (spec.startsWith('.')) base = resolve(dirname(from), spec);
  else return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function stringLiteral(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

type ModuleInfo = {
  directive: string | undefined;
  imports: string[];
  namespaces: string[];
  dynamic: string[];
  rootTranslator: boolean;
  rootLiteralKeys: string[];
  validationNamespaces: string[];
};

function analyze(file: string): ModuleInfo {
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf-8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const first = sf.statements[0];
  const directive =
    first && ts.isExpressionStatement(first) ? stringLiteral(first.expression) : undefined;
  const info: ModuleInfo = {
    directive,
    imports: [],
    namespaces: [],
    dynamic: [],
    rootTranslator: false,
    rootLiteralKeys: [],
    validationNamespaces: [],
  };
  const where = (node: ts.Node) =>
    `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const rootNames = new Set<string>();

  for (const statement of sf.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) && statement.moduleSpecifier) {
      if (ts.isImportDeclaration(statement) && statement.importClause?.isTypeOnly) continue;
      if (ts.isExportDeclaration(statement) && statement.isTypeOnly) continue;
      const target = resolveImport(file, (statement.moduleSpecifier as ts.StringLiteral).text);
      if (target) info.imports.push(target);
    }
  }

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const name = node.expression.text;
      if (name === 'useTranslations') {
        const arg = node.arguments[0];
        const ns = stringLiteral(arg);
        if (!arg) {
          info.rootTranslator = true;
          const parent = node.parent;
          if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) rootNames.add(parent.name.text);
        } else if (ns !== undefined) info.namespaces.push(ns.split('.')[0]!);
        else info.dynamic.push(`${where(node)} useTranslations(${arg.getText()})`);
      } else if (name === 'useMessages') {
        info.dynamic.push(`${where(node)} useMessages()`);
      } else if (rootNames.has(name)) {
        const key = stringLiteral(node.arguments[0]);
        if (key !== undefined) info.rootLiteralKeys.push(key.split('.')[0]!);
      }
    }
    const literal = stringLiteral(node);
    const match = literal !== undefined ? VALIDATION_KEY.exec(literal) : null;
    if (match) info.validationNamespaces.push(match[1]!);
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return info;
}

const files = sourceFiles(SRC);
const modules = new Map(files.map((file) => [file, analyze(file)]));

const clientGraph = new Set<string>();
const stack = files.filter((file) => modules.get(file)!.directive === 'use client');
while (stack.length > 0) {
  const file = stack.pop()!;
  const info = modules.get(file)!;
  if (clientGraph.has(file) || info.directive === 'use server') continue;
  clientGraph.add(file);
  stack.push(...info.imports);
}

const clientModules = [...clientGraph].map((file) => modules.get(file)!);
const hasRootTranslator = clientModules.some((m) => m.rootTranslator);
const validationNamespaces = new Set([...modules.values()].flatMap((m) => m.validationNamespaces));
const required = new Set<string>([
  ...clientModules.flatMap((m) => m.namespaces),
  ...clientModules.flatMap((m) => m.rootLiteralKeys),
  ...(hasRootTranslator ? ['errors', ...validationNamespaces] : []),
]);
const allowed = new Set<string>(CLIENT_MESSAGE_NAMESPACES);

describe('wiadomości wysyłane do klienta (NextIntlClientProvider)', () => {
  it('skaner faktycznie widzi graf klienta', () => {
    // Straż przed „cichym” zepsuciem skanera (wtedy asercje niżej przechodziłyby na pusto).
    expect(clientGraph.size).toBeGreaterThan(50);
    expect(required).toContain('cookies'); // CookieConsent
    expect(required).toContain('errors'); // error.tsx + translator bez przestrzeni
    expect(validationNamespaces.size).toBeGreaterThan(3);
  });

  it('komponenty klienckie nie używają dynamicznych przestrzeni nazw ani useMessages()', () => {
    expect(clientModules.flatMap((m) => m.dynamic)).toEqual([]);
  });

  it('każda przestrzeń nazw użyta po stronie klienta jest na liście', () => {
    expect([...required].filter((ns) => !allowed.has(ns)).sort()).toEqual([]);
  });

  it('lista nie zawiera przestrzeni, których klient nie używa, ani nieistniejących', () => {
    expect([...allowed].filter((ns) => !required.has(ns)).sort()).toEqual([]);
    expect([...allowed].filter((ns) => !(ns in pl)).sort()).toEqual([]);
  });

  it('pickClientMessages przekazuje dokładnie listę i pomija przestrzenie serwerowe', () => {
    const picked = pickClientMessages(pl as Record<string, unknown>);
    expect(Object.keys(picked).sort()).toEqual([...CLIENT_MESSAGE_NAMESPACES].sort());
    expect(picked).not.toHaveProperty('billing');
    expect(picked).not.toHaveProperty('legal');
    expect(picked.errors).toBe(pl.errors);
  });
});
