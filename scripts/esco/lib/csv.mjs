/**
 * Minimalny parser/zapis CSV (RFC 4180) dla plików ESCO (#93). Bez zależności:
 * pola w cudzysłowie mogą zawierać przecinki, `""` i znaki nowej linii (ESCO trzyma
 * etykiety alternatywne w jednym polu, rozdzielone `\n`). BOM UTF-8 jest usuwany.
 */

/**
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  if (typeof text !== 'string') throw new TypeError('CSV: oczekiwano tekstu.');
  const input = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let fieldStarted = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (quoted) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      if (fieldStarted && field.length > 0) throw new Error(`CSV: cudzysłów w środku pola (wiersz ${rows.length + 1}).`);
      quoted = true;
      fieldStarted = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
      fieldStarted = false;
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && input[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      fieldStarted = false;
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (quoted) throw new Error('CSV: niezamknięty cudzysłów.');
  if (fieldStarted || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Wiersze jako obiekty wg nagłówka. Brak wymaganej kolumny = błąd z nazwą kolumny.
 * @param {string} text
 * @param {string[]} required
 * @returns {Array<Record<string, string>>}
 */
export function parseCsvObjects(text, required = []) {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error('CSV: pusty plik.');
  const names = header.map(name => name.trim());
  const missing = required.filter(name => !names.includes(name));
  if (missing.length) throw new Error(`CSV: brak kolumn: ${missing.join(', ')}.`);
  return rows
    .filter(cells => !(cells.length === 1 && cells[0] === ''))
    .map((cells, index) => {
      if (cells.length !== names.length) {
        throw new Error(`CSV: wiersz ${index + 2} ma ${cells.length} pól zamiast ${names.length}.`);
      }
      return Object.fromEntries(names.map((name, column) => [name, cells[column]]));
    });
}

/** @param {string} value */
function quote(value) {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * @param {string[]} header
 * @param {Array<Record<string, string>>} rows
 */
export function writeCsv(header, rows) {
  const lines = [header.map(quote).join(',')];
  for (const row of rows) lines.push(header.map(name => quote(row[name] ?? '')).join(','));
  return `${lines.join('\n')}\n`;
}
