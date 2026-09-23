import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, resolve } from 'path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Test użycia tłumaczeń (Invariant #2) — uzupełnia i18n-keys.test.ts (równość zbiorów kluczy).
 *
 * 1. Klucze użyte w kodzie istnieją w pl.json. Analiza statyczna (AST TypeScript, z zasięgiem
 *    zmiennych): translator z `useTranslations('ns')` / `getTranslations('ns' | { namespace })`
 *    wywołany z LITERAŁEM (`t('key')`, `t.rich/markup/raw('key')`) → sprawdzamy `ns.key`.
 *    Klucze dynamiczne (zmienne, template stringi) oraz `t.has(...)` są pomijane z założenia —
 *    ten test ich nie zgaduje, więc nie daje fałszywych alarmów.
 * 2. Klucze komunikatów walidacji (literały `'<ns>.error.<key>'`, np. w schematach Zod) istnieją
 *    w pl.json — formularze tłumaczą je pełną ścieżką.
 * 3. Każda wartość tekstowa jest niepusta, a argumenty ICU (`{count}`, `{name}`, tagi `<b>`)
 *    są te same we wszystkich językach co w pl (treść gałęzi plural/select może się różnić).
 *
 * Znane wyjątki są jawne (KNOWN_MISSING) i wskazują issue; wpis nieaktualny też psuje test.
 */

const LOCALES = ['pl', 'nl', 'fr', 'en'] as const;
const ROOT = process.cwd();
const SRC = resolve(ROOT, 'src');

/**
 * Klucze używane w kodzie, których jeszcze nie ma w tłumaczeniach — do usunięcia razem z poprawką.
 * Issue: https://github.com/aktualnosci-be/pracujbe/issues/236
 */
const KNOWN_MISSING = new Set<string>([
  'application.error.idempotencyKeyInvalid',
  'application.error.jobInvalid',
  'application.error.jobRequired',
  'application.error.messageTooLong',
  'application.error.phoneInvalid',
  'application.error.termsRequired',
  'offer.error.candidateInvalid',
  'offer.error.candidateRequired',
  'offer.error.idempotencyKeyInvalid',
  'offer.error.idempotencyKeyRequired',
  'offer.error.jobInvalid',
  'offer.error.jobRequired',
  'offer.error.messageRequired',
  'offer.error.messageTooLong',
  'offer.error.messageTooShort',
]);

type Messages = Record<string, unknown>;

function loadMessages(locale: string): Messages {
  return JSON.parse(readFileSync(resolve(SRC, 'messages', `${locale}.json`), 'utf-8')) as Messages;
}

function flatten(value: unknown, prefix = '', out = new Map<string, unknown>()): Map<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flatten(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.set(prefix, value);
  }
  return out;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(path);
  }
  return out;
}

type Usage = { key: string; where: string };

const TRANSLATOR_FACTORIES = new Set(['useTranslations', 'getTranslations']);
const LITERAL_METHODS = new Set(['rich', 'markup', 'raw']);
const VALIDATION_KEY = /^[a-z][A-Za-z]*\.error\.[A-Za-z]+$/;

function stringLiteral(node: ts.Node | undefined): string | undefined {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** Namespace z wywołania fabryki translatora; `undefined` = nie da się ustalić statycznie. */
function namespaceOf(call: ts.CallExpression): string | undefined {
  const arg = call.arguments[0];
  if (!arg) return '';
  const literal = stringLiteral(arg);
  if (literal !== undefined) return literal;
  if (ts.isObjectLiteralExpression(arg)) {
    const ns = arg.properties.find(
      (p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'namespace',
    );
    if (!ns) return arg.properties.some((p) => p.name?.getText() === 'namespace') ? undefined : '';
    return stringLiteral(ns.initializer);
  }
  return undefined;
}

function translatorCall(node: ts.Expression | undefined): ts.CallExpression | undefined {
  let current = node;
  while (current && (ts.isAwaitExpression(current) || ts.isParenthesizedExpression(current))) current = current.expression;
  if (current && ts.isCallExpression(current) && ts.isIdentifier(current.expression)) {
    return TRANSLATOR_FACTORIES.has(current.expression.text) ? current : undefined;
  }
  return undefined;
}

function collectUsages(file: string): { translations: Usage[]; validation: Usage[] } {
  const text = readFileSync(file, 'utf-8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const translations: Usage[] = [];
  const validation: Usage[] = [];
  const scopes: Array<Map<string, string | undefined>> = [new Map()];
  const where = (node: ts.Node) =>
    `${relative(ROOT, file)}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;

  const bind = (name: ts.BindingName, ns: string | undefined) => {
    if (ts.isIdentifier(name)) scopes[scopes.length - 1]!.set(name.text, ns);
  };
  const lookup = (name: string): string | undefined | null => {
    for (let i = scopes.length - 1; i >= 0; i -= 1) if (scopes[i]!.has(name)) return scopes[i]!.get(name);
    return null; // nie translator
  };
  // Każda deklaracja o tej nazwie w zasięgu przesłania translator z zewnątrz (np. parametr `t`).
  const shadow = (name: ts.BindingName) => {
    if (ts.isIdentifier(name)) scopes[scopes.length - 1]!.set(name.text, undefined);
  };

  const visit = (node: ts.Node): void => {
    const opensScope = ts.isBlock(node) || ts.isFunctionLike(node) || ts.isSourceFile(node) || ts.isCaseBlock(node);
    if (opensScope && !ts.isSourceFile(node)) scopes.push(new Map());
    if (ts.isFunctionLike(node)) for (const p of node.parameters) shadow(p.name);

    if (ts.isVariableDeclaration(node)) {
      const call = translatorCall(node.initializer);
      if (call) bind(node.name, namespaceOf(call));
      else if (ts.isArrayBindingPattern(node.name) && node.initializer) {
        // const [tA, tB] = await Promise.all([getTranslations('a'), getTranslations('b')])
        let init: ts.Expression = node.initializer;
        if (ts.isAwaitExpression(init)) init = init.expression;
        const list = ts.isCallExpression(init) ? init.arguments[0] : undefined;
        node.name.elements.forEach((element, index) => {
          if (!ts.isBindingElement(element)) return;
          const item = list && ts.isArrayLiteralExpression(list) ? list.elements[index] : undefined;
          const inner = translatorCall(item);
          if (inner) bind(element.name, namespaceOf(inner));
          else shadow(element.name);
        });
      } else shadow(node.name);
    }

    if (ts.isCallExpression(node)) {
      let callee: ts.Expression = node.expression;
      let method: string | undefined;
      if (ts.isPropertyAccessExpression(callee)) {
        method = callee.name.text;
        callee = callee.expression;
      }
      if (ts.isIdentifier(callee) && (method === undefined || LITERAL_METHODS.has(method))) {
        const ns = lookup(callee.text);
        const key = stringLiteral(node.arguments[0]);
        if (ns !== null && ns !== undefined && key !== undefined) {
          translations.push({ key: ns ? `${ns}.${key}` : key, where: where(node) });
        }
      }
    }

    const literal = stringLiteral(node);
    if (literal !== undefined && VALIDATION_KEY.test(literal)) validation.push({ key: literal, where: where(node) });

    ts.forEachChild(node, visit);
    if (opensScope && !ts.isSourceFile(node)) scopes.pop();
  };
  visit(sf);
  return { translations, validation };
}

/**
 * Minimalny parser ICU: zwraca posortowane nazwy argumentów i tagów (`<b>`).
 * Treść gałęzi plural/select jest parsowana rekurencyjnie, ale jej tekst się nie liczy.
 */
function icuArguments(message: string): string[] {
  const found = new Set<string>();
  let i = 0;
  const ws = () => {
    while (i < message.length && /\s/.test(message[i]!)) i += 1;
  };
  const word = () => {
    const start = i;
    while (i < message.length && !/[\s,{}]/.test(message[i]!)) i += 1;
    return message.slice(start, i);
  };
  const parseMessage = (nested: boolean) => {
    while (i < message.length) {
      const ch = message[i]!;
      if (ch === "'") {
        if (message[i + 1] === "'") i += 2;
        else if (message[i + 1] === '{' || message[i + 1] === '}') {
          const end = message.indexOf("'", i + 1);
          i = end === -1 ? message.length : end + 1;
        } else i += 1;
      } else if (ch === '{') {
        i += 1;
        parseArgument();
      } else if (ch === '}') {
        if (nested) return;
        i += 1;
      } else if (ch === '<') {
        const tag = /^<\/?([A-Za-z][\w-]*)\s*\/?>/.exec(message.slice(i));
        if (tag) {
          found.add(`<${tag[1]}>`);
          i += tag[0].length;
        } else i += 1;
      } else i += 1;
    }
  };
  const parseArgument = () => {
    ws();
    found.add(word());
    ws();
    if (message[i] === '}') {
      i += 1;
      return;
    }
    i += 1; // ','
    ws();
    const type = word();
    ws();
    if (['plural', 'select', 'selectordinal'].includes(type)) {
      i += 1; // ','
      for (;;) {
        ws();
        if (i >= message.length || message[i] === '}') break;
        word(); // selektor (one, other, =0, offset:1)
        ws();
        if (message[i] === '{') {
          i += 1;
          parseMessage(true);
          i += 1; // '}' gałęzi
        }
      }
      i += 1; // '}' argumentu
    } else {
      let depth = 1;
      while (i < message.length && depth > 0) {
        if (message[i] === '{') depth += 1;
        else if (message[i] === '}') depth -= 1;
        i += 1;
      }
    }
  };
  parseMessage(false);
  return [...found].sort();
}

describe('użycie kluczy tłumaczeń', () => {
  const pl = flatten(loadMessages('pl'));
  const usages = sourceFiles(SRC).map(collectUsages);
  const translations = usages.flatMap((u) => u.translations);
  const validation = usages.flatMap((u) => u.validation);

  it('analiza statyczna faktycznie znajduje wywołania t() i klucze walidacji', () => {
    // Straż przed „cichym” zepsuciem skanera (wtedy test poniżej przechodziłby na pusto).
    expect(translations.length).toBeGreaterThan(500);
    expect(validation.length).toBeGreaterThan(50);
  });

  it('każdy klucz użyty literałem w t() istnieje w pl.json', () => {
    const missing = translations.filter((u) => typeof pl.get(u.key) !== 'string' && !KNOWN_MISSING.has(u.key));
    expect(missing.map((u) => `${u.where} → ${u.key}`)).toEqual([]);
  });

  it('każdy klucz komunikatu walidacji (`<ns>.error.<key>`) istnieje w pl.json', () => {
    const missing = validation.filter((u) => typeof pl.get(u.key) !== 'string' && !KNOWN_MISSING.has(u.key));
    expect(missing.map((u) => `${u.where} → ${u.key}`)).toEqual([]);
  });

  it('lista znanych wyjątków jest aktualna (klucz dodany lub przestał być używany → usuń wpis)', () => {
    const used = new Set([...translations, ...validation].map((u) => u.key));
    const stale = [...KNOWN_MISSING].filter((key) => typeof pl.get(key) === 'string' || !used.has(key));
    expect(stale).toEqual([]);
  });
});

describe('wartości tłumaczeń', () => {
  const flat = Object.fromEntries(LOCALES.map((l) => [l, flatten(loadMessages(l))])) as Record<
    (typeof LOCALES)[number],
    Map<string, unknown>
  >;

  it('żadna wartość nie jest pusta', () => {
    const empty = LOCALES.flatMap((l) =>
      [...flat[l]].filter(([, v]) => typeof v !== 'string' || v.trim() === '').map(([k]) => `${l}: ${k}`),
    );
    expect(empty).toEqual([]);
  });

  it('argumenty ICU i tagi są takie same jak w pl', () => {
    const mismatches: string[] = [];
    for (const [key, value] of flat.pl) {
      if (typeof value !== 'string') continue;
      const expected = icuArguments(value).join(',');
      for (const locale of LOCALES.slice(1)) {
        const other = flat[locale].get(key);
        if (typeof other !== 'string') continue;
        const actual = icuArguments(other).join(',');
        if (actual !== expected) mismatches.push(`${locale}: ${key} [${actual}] ≠ pl [${expected}]`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it('parser ICU pomija treść gałęzi plural/select', () => {
    expect(icuArguments('{count, plural, =0 {Brak} one {# oferta} other {# ofert}} w {city}')).toEqual([
      'city',
      'count',
    ]);
    expect(icuArguments('Witaj, <b>{name}</b>')).toEqual(['<b>', 'name']);
    expect(icuArguments("It''s '{literal}' {n, number}")).toEqual(['n']);
  });
});
