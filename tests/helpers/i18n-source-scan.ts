import { readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/**
 * Analiza statyczna kodu pod kątem Invariantu #2 („brak tekstów UI na sztywno”, #1114 TQ2-09).
 * Wspólna dla strażników `i18n-jsx-literals.test.ts` i `i18n-unused-keys.test.ts`.
 */

export type Messages = Record<string, unknown>;

export function flattenMessageKeys(value: unknown, prefix = '', out: string[] = []): string[] {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenMessageKeys(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out.push(prefix);
  }
  return out;
}

/** Pliki `.ts/.tsx/.mjs/.js` (bez `.d.ts`), z pominięciem katalogów o podanych nazwach. */
export function listSourceFiles(dir: string, skipDirs: ReadonlySet<string> = new Set(), out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (!skipDirs.has(name)) listSourceFiles(path, skipDirs, out);
    } else if (/\.(?:tsx?|mjs|js)$/.test(name) && !/\.d\.ts$/.test(name)) {
      out.push(path);
    }
  }
  return out;
}

function parse(fileName: string, source: string): ts.SourceFile {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : fileName.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
}

// --- Literały w JSX -------------------------------------------------------------------------

/** Atrybuty, których wartość widzi albo słyszy użytkownik (czytnik ekranu, dymek, podpowiedź). */
export const USER_VISIBLE_ATTRIBUTES: ReadonlySet<string> = new Set([
  'alt',
  'aria-description',
  'aria-label',
  'aria-placeholder',
  'aria-roledescription',
  'aria-valuetext',
  'label',
  'placeholder',
  'title',
]);

const HAS_LETTER = /\p{L}/u;

/** Treść tych elementów to kod (CSS/JS/JSON-LD), nie tekst dla użytkownika. */
const CODE_ELEMENTS: ReadonlySet<string> = new Set(['script', 'style']);

function insideCodeElement(node: ts.Node, sf: ts.SourceFile): boolean {
  const parent = node.parent;
  if (parent && ts.isJsxElement(parent)) return CODE_ELEMENTS.has(parent.openingElement.tagName.getText(sf));
  return false;
}

export type JsxLiteral = {
  file: string;
  line: number;
  /** `text` = treść elementu; inaczej nazwa atrybutu. */
  where: string;
  value: string;
};

function stringValue(node: ts.Node | undefined): string | null {
  if (!node) return null;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return null;
}

/**
 * Literały tekstowe widoczne w UI: treść JSX (`<p>Zapisz</p>`, `<p>{'Zapisz'}</p>`) i wartości
 * atrybutów z `USER_VISIBLE_ATTRIBUTES`. Tekst bez litery (liczby, `·`, `—`, `%`) nie jest tekstem UI.
 */
export function findJsxLiterals(fileName: string, source: string, root = ''): JsxLiteral[] {
  const sf = parse(fileName, source);
  const file = root ? relative(root, fileName).split('\\').join('/') : fileName;
  const found: JsxLiteral[] = [];
  const push = (node: ts.Node, where: string, value: string) => {
    const text = value.replace(/\s+/g, ' ').trim();
    if (!HAS_LETTER.test(text)) return;
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, where, value: text });
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node)) {
      if (!insideCodeElement(node, sf)) push(node, 'text', node.text);
    } else if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      if (insideCodeElement(node, sf)) return;
      const value = stringValue(node.expression);
      if (value !== null) push(node, 'text', value);
    } else if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText(sf);
      if (USER_VISIBLE_ATTRIBUTES.has(name)) {
        const init = node.initializer;
        const value = ts.isStringLiteral(init) ? init.text : ts.isJsxExpression(init) ? stringValue(init.expression) : null;
        if (value !== null) push(node, name, value);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

// --- Klucze tłumaczeń używane w kodzie ------------------------------------------------------

export type KeyUsageIndex = {
  /** Identyfikatory i fragmenty literałów (także części rozdzielone kropką). */
  words: Set<string>;
  /** Stały początek kluczy dynamicznych: `landing.cat_${x}` → `cat_`. */
  heads: Set<string>;
  /** Stały koniec kluczy dynamicznych: `${key}Title` → `Title`. */
  tails: Set<string>;
};

const WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g;

function addWords(index: KeyUsageIndex, text: string) {
  for (const word of text.match(WORD) ?? []) index.words.add(word);
}

/** Ostatni fragment klucza przed `${…}` (po kropce) i pierwszy po nim. */
function lastToken(text: string): string {
  const match = /([A-Za-z0-9_]+)$/.exec(text);
  return match?.[1] ?? '';
}
function firstToken(text: string): string {
  const match = /^([A-Za-z0-9_]+)/.exec(text);
  return match?.[1] ?? '';
}

export function buildKeyUsageIndex(files: readonly { fileName: string; source: string }[]): KeyUsageIndex {
  const index: KeyUsageIndex = { words: new Set(), heads: new Set(), tails: new Set() };
  for (const { fileName, source } of files) {
    const sf = parse(fileName, source);
    const visit = (node: ts.Node) => {
      if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) index.words.add(node.text);
      else if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) addWords(index, node.text);
      else if (ts.isTemplateExpression(node)) {
        const literals = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
        literals.forEach((text, i) => {
          addWords(index, text);
          if (i < literals.length - 1) {
            const head = lastToken(text);
            if (head) index.heads.add(head);
          }
          if (i > 0) {
            const tail = firstToken(text);
            if (tail) index.tails.add(tail);
          }
        });
      } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
        const left = stringValue(node.left);
        const right = stringValue(node.right);
        if (left !== null && lastToken(left)) index.heads.add(lastToken(left));
        if (right !== null && firstToken(right)) index.tails.add(firstToken(right));
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return index;
}

/**
 * Czy klucz może być użyty. Heurystyka bez fałszywych alarmów: ostatni człon klucza występuje
 * w kodzie jako identyfikator albo fragment literału, albo pasuje do klucza dynamicznego
 * (stały początek z `…_${x}` albo stały koniec z `${x}Title` doklejony do słowa z kodu).
 */
export function isKeyPossiblyUsed(key: string, index: KeyUsageIndex): boolean {
  const leaf = key.slice(key.lastIndexOf('.') + 1);
  if (index.words.has(leaf)) return true;
  for (const head of index.heads) if (leaf.length > head.length && leaf.startsWith(head)) return true;
  for (const tail of index.tails) {
    if (leaf.length > tail.length && leaf.endsWith(tail) && index.words.has(leaf.slice(0, -tail.length))) return true;
  }
  return false;
}
