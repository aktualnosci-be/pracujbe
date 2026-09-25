/**
 * Zakres danych kolejkowanych do e-maili (#503) — z aktualnych definicji funkcji SQL.
 *
 * Dla każdej funkcji bierzemy OSTATNIĄ definicję (`create or replace function`) w kolejności
 * migracji, szukamy w niej wywołań `enqueue_email*` i zbieramy klucze z `jsonb_build_object`
 * przekazanego jako payload. Typ szablonu = pierwszy literał w wywołaniu, który jest znanym
 * typem e-maila. To odczyt statyczny: pokazuje klucze, nie wartości; dane dokładane przez
 * worker (`src/lib/email/delivery-data.ts`, `guest-delivery.ts`) opisuje dokument ręcznie.
 */

/** Usuwa komentarze SQL, zachowując literały i bloki `$$`. */
export function stripComments(sql) {
  let out = "";
  let i = 0;
  let inString = false;
  while (i < sql.length) {
    const ch = sql[i];
    if (inString) {
      out += ch;
      if (ch === "'" && sql[i + 1] === "'") {
        out += "'";
        i += 2;
        continue;
      }
      if (ch === "'") inString = false;
      i++;
      continue;
    }
    if (ch === "'") inString = true;
    if (ch === "-" && sql[i + 1] === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      continue;
    }
    if (ch === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end === -1 ? sql.length : end + 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Treść w nawiasach zaczynających się na `open` (indeks znaku `(`). */
function balanced(text, open) {
  let depth = 0;
  let inString = false;
  for (let i = open; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'" && text[i + 1] === "'") i++;
      else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    else if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) return text.slice(open + 1, i);
    }
  }
  return text.slice(open + 1);
}

/** Argumenty najwyższego poziomu (przecinki poza nawiasami i literałami). */
function topLevelArgs(body) {
  const args = [];
  let depth = 0;
  let inString = false;
  let current = "";
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (inString) {
      current += ch;
      if (ch === "'" && body[i + 1] === "'") {
        current += "'";
        i++;
      } else if (ch === "'") inString = false;
      continue;
    }
    if (ch === "'") inString = true;
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      args.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) args.push(current.trim());
  return args;
}

function payloadKeys(call) {
  const at = call.search(/jsonb_build_object\s*\(/i);
  if (at === -1) return [];
  const open = call.indexOf("(", at);
  const args = topLevelArgs(balanced(call, open));
  const keys = [];
  for (let i = 0; i < args.length; i += 2) {
    const literal = /^'([^']*)'$/.exec(args[i]);
    if (literal) keys.push(literal[1]);
  }
  return keys;
}

/**
 * `files` = [{ path, sql }] w kolejności wdrożenia; `emailTypes` = znane typy szablonów.
 * Zwraca Map<typ, { keys: string[], functions: string[] }> (posortowane).
 */
export function extractEmailPayloads(files, emailTypes) {
  const known = new Set(emailTypes);
  const functions = new Map();
  const headerRe = /create\s+(?:or\s+replace\s+)?function\s+((?:[A-Za-z_]+\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\(/gi;
  // `alter function x(...) rename to y` (np. 0126: wrapper nad dawną funkcją) przenosi definicję.
  const renameRe = /alter\s+function\s+((?:[A-Za-z_]+\.)?[A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s*rename\s+to\s+([A-Za-z_][A-Za-z0-9_]*)/gi;
  const bare = (name) => name.toLowerCase().replace(/^public\./, "");
  for (const { path, sql } of files) {
    const text = stripComments(sql);
    const headers = [...text.matchAll(headerRe)];
    const events = [
      ...headers.map((match, index) => ({ at: match.index, kind: "create", match, index })),
      ...[...text.matchAll(renameRe)].map((match) => ({ at: match.index, kind: "rename", match })),
    ].sort((a, b) => a.at - b.at);
    for (const event of events) {
      if (event.kind === "rename") {
        const from = bare(event.match[1]);
        const entry = functions.get(from);
        if (entry) {
          functions.delete(from);
          functions.set(bare(event.match[2]), entry);
        }
        continue;
      }
      const { match, index } = event;
      const end = index + 1 < headers.length ? headers[index + 1].index : text.length;
      functions.set(bare(match[1]), { path, body: text.slice(match.index, end) });
    }
  }

  const result = new Map();
  for (const [name, { body }] of functions) {
    // Pomijamy definicje samych funkcji kolejkujących — ich ciała nie wskazują szablonu.
    if (/^enqueue_/.test(name)) continue;
    for (const call of body.matchAll(/\benqueue_[a-z_]*email[a-z_]*\s*\(/gi)) {
      const args = balanced(body, call.index + call[0].length - 1);
      const literals = (text) =>
        [...new Set([...text.matchAll(/'([A-Za-z]+)'/g)].map((m) => m[1]))].filter((t) => known.has(t));
      const variables = topLevelArgs(args).filter((a) => /^v_[a-z0-9_]+$/i.test(a));
      // Szablon: literały w wywołaniu (także gałęzie CASE) albo zmienna przypisana w funkcji.
      let templates = literals(args);
      if (templates.length === 0) {
        for (const variable of variables) {
          const decl = new RegExp(`\\b${variable}\\s+text\\s*:=([^;]*);`, "i").exec(body);
          if (decl) templates = literals(decl[1]);
          if (templates.length) break;
        }
      }
      // Payload: jsonb_build_object w wywołaniu albo w przypisaniu do zmiennej.
      let keys = payloadKeys(args);
      if (keys.length === 0) {
        for (const variable of variables) {
          const assign = new RegExp(`\\b${variable}\\s*:=\\s*(?=[a-z_]*\\(?jsonb_build_object)`, "i").exec(body);
          if (assign) keys = payloadKeys(body.slice(assign.index));
          if (keys.length) break;
        }
      }
      for (const template of templates) {
        const entry = result.get(template) ?? { keys: new Set(), functions: new Set() };
        for (const key of keys) entry.keys.add(key);
        entry.functions.add(name);
        result.set(template, entry);
      }
    }
  }
  return new Map(
    [...result]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([template, { keys, functions: fns }]) => [
        template,
        { keys: [...keys].sort(), functions: [...fns].sort() },
      ]),
  );
}
