import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * Minimalny parser schematu z migracji SQL na potrzeby mapy danych osobowych (#485).
 *
 * Czyta `create table` i `alter table … add column` w kolejności wdrożenia produkcyjnego
 * (`database/bootstrap` → `supabase/migrations` → `database/auth`, jak
 * `scripts/db/production-migrations.mjs`). Treść funkcji (`$$ … $$`), literały i komentarze
 * są pomijane, więc tabele tymczasowe w ciałach funkcji nie trafiają do mapy.
 * Nie jest to pełny parser PostgreSQL — wystarcza dla stylu migracji tego repozytorium;
 * test `privacy-data-map.test.ts` pilnuje, że wynik obejmuje znane tabele.
 */

export const MIGRATION_DIRS = ["database/bootstrap", "supabase/migrations", "database/auth"];

/** Usuwa komentarze, literały i bloki dollar-quoted; zostawia strukturę DDL. */
export function stripSql(sql) {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === "-" && next === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += " ";
      continue;
    }
    if (ch === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out += "''";
      continue;
    }
    if (ch === "$") {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        const end = sql.indexOf(tag[0], i + tag[0].length);
        i = end === -1 ? sql.length : end + tag[0].length;
        out += " ";
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/** Dzieli treść po przecinkach najwyższego poziomu (poza nawiasami). */
function splitTopLevel(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function unquote(identifier) {
  return identifier.replace(/"/g, "").toLowerCase();
}

function qualify(name) {
  const clean = unquote(name);
  return clean.includes(".") ? clean : `public.${clean}`;
}

const NOT_A_COLUMN = /^(constraint|primary|unique|check|foreign|exclude|like)\b/i;

function columnFrom(definition) {
  const match = /^("?[A-Za-z_][A-Za-z0-9_]*"?)\s+(.+)$/s.exec(definition.trim());
  if (!match || NOT_A_COLUMN.test(definition.trim())) return null;
  const type = match[2].trim().split(/\s+/)[0].toLowerCase();
  return { name: unquote(match[1]), type };
}

/**
 * Zwraca Map<"schemat.tabela", { name, source, columns: Map<kolumna, { type, source }> }>.
 * `files` = [{ path, sql }] w kolejności wdrożenia.
 */
export function parseSchema(files) {
  const tables = new Map();
  for (const { path, sql } of files) {
    const text = stripSql(sql);
    const createRe =
      /create\s+(?:unlogged\s+)?table\s+(?:if\s+not\s+exists\s+)?((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s*\(/gi;
    let m;
    while ((m = createRe.exec(text))) {
      let depth = 1;
      let j = createRe.lastIndex;
      while (j < text.length && depth > 0) {
        if (text[j] === "(") depth++;
        if (text[j] === ")") depth--;
        j++;
      }
      const name = qualify(m[1]);
      const table = tables.get(name) ?? { name, source: path, columns: new Map() };
      for (const part of splitTopLevel(text.slice(createRe.lastIndex, j - 1))) {
        const column = columnFrom(part);
        if (column && !table.columns.has(column.name)) {
          table.columns.set(column.name, { type: column.type, source: path });
        }
      }
      tables.set(name, table);
    }

    const alterRe =
      /alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?((?:"?[A-Za-z_][A-Za-z0-9_]*"?\.)?"?[A-Za-z_][A-Za-z0-9_]*"?)\s+([^;]*);/gi;
    while ((m = alterRe.exec(text))) {
      const name = qualify(m[1]);
      for (const part of splitTopLevel(m[2])) {
        const add = /^add\s+column\s+(?:if\s+not\s+exists\s+)?(.+)$/is.exec(part.trim());
        if (!add) continue;
        const column = columnFrom(add[1]);
        if (!column) continue;
        const table = tables.get(name) ?? { name, source: path, columns: new Map() };
        if (!table.columns.has(column.name)) {
          table.columns.set(column.name, { type: column.type, source: path });
        }
        tables.set(name, table);
      }
    }
  }
  return tables;
}

/** Wczytuje migracje produkcyjne z repozytorium (ścieżki względne do `root`). */
export function loadMigrationFiles(root) {
  const files = [];
  for (const dir of MIGRATION_DIRS) {
    const abs = resolve(root, dir);
    for (const file of readdirSync(abs).filter((f) => f.endsWith(".sql")).sort()) {
      const path = join(abs, file);
      files.push({ path: relative(root, path), sql: readFileSync(path, "utf8") });
    }
  }
  return files;
}
