// Pure converters for tabular and configuration formats.
import Papa from 'papaparse';
import JSON5 from 'json5';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import { parseMarkdownTable, renderMarkdownTable } from '../markdown/tables.js';
import { parseJson } from '../formats/json.js';

// ---------------------------------------------------------------- CSV / TSV
export const DELIMITERS = { comma: ',', tab: '\t', semicolon: ';', pipe: '|' };
const resolveDelimiter = (value) => DELIMITERS[value] ?? (value === 'auto' ? '' : value);

export function parseCsv(text, { delimiter = 'auto', header = true } = {}) {
  const result = Papa.parse(String(text).replace(/\r?\n$/, ''), {
    delimiter: resolveDelimiter(delimiter),
    header: false,
    skipEmptyLines: 'greedy',
  });
  const fatal = result.errors.find((error) => error.type === 'Quotes');
  if (fatal) throw new Error(`Invalid CSV at row ${fatal.row + 1}: ${fatal.message}`);
  const rows = result.data;
  if (rows.length === 0) throw new Error('No CSV rows found.');
  if (!header) return { headers: rows[0].map((_, i) => `column${i + 1}`), rows, delimiter: result.meta.delimiter };
  const headers = rows[0].map((name, i) => (String(name).trim() === '' ? `column${i + 1}` : String(name)));
  const width = Math.max(headers.length, ...rows.map((row) => row.length));
  while (headers.length < width) headers.push(`column${headers.length + 1}`);
  return {
    headers,
    rows: rows.slice(1).map((row) => headers.map((_, i) => row[i] ?? '')),
    delimiter: result.meta.delimiter,
  };
}

export function inferScalar(value) {
  if (value === '') return '';
  if (
    /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(value) &&
    Number.isFinite(Number(value)) &&
    (Number.isSafeInteger(Number(value)) || /[.eE]/.test(value))
  )
    return Number(value);
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  return value;
}

export function csvToJson(text, { delimiter = 'auto', header = true, inferTypes = true, indent = 2 } = {}) {
  const { headers, rows } = parseCsv(text, { delimiter, header });
  const convert = (value) => (inferTypes ? inferScalar(value) : value);
  const data = header
    ? rows.map((row) => Object.fromEntries(headers.map((name, i) => [name, convert(row[i])])))
    : rows.map((row) => row.map(convert));
  return JSON.stringify(data, null, indent);
}

function flattenForCsv(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value)) flattenForCsv(child, prefix ? `${prefix}.${key}` : key, out);
  } else {
    out[prefix] = Array.isArray(value) ? JSON.stringify(value) : value;
  }
  return out;
}

export function jsonToCsv(text, { delimiter = 'comma', flatten = true } = {}) {
  let data = parseJson(text);
  if (!Array.isArray(data)) data = [data];
  if (data.length === 0) throw new Error('JSON array is empty.');
  let headers;
  let rows;
  if (data.every(Array.isArray)) {
    rows = data;
    return Papa.unparse(rows, { delimiter: resolveDelimiter(delimiter) || ',', newline: '\n' });
  }
  const records = data.map((item) =>
    item && typeof item === 'object' ? (flatten ? flattenForCsv(item) : item) : { value: item },
  );
  headers = Array.from(new Set(records.flatMap((record) => Object.keys(record))));
  rows = records.map((record) =>
    headers.map((key) => {
      const value = record[key];
      if (value === undefined || value === null) return '';
      return typeof value === 'object' ? JSON.stringify(value) : String(value);
    }),
  );
  return Papa.unparse(
    { fields: headers, data: rows },
    { delimiter: resolveDelimiter(delimiter) || ',', newline: '\n' },
  );
}

export function csvToMarkdownTable(text, { delimiter = 'auto', header = true } = {}) {
  const { headers, rows } = parseCsv(text, { delimiter, header });
  return renderMarkdownTable({ headers, align: headers.map(() => 'none'), rows });
}

export function markdownTableToCsv(text, { delimiter = 'comma' } = {}) {
  const { headers, rows } = parseMarkdownTable(text);
  const unescape = (cell) => cell.replace(/\\\|/g, '|').replace(/<br\s*\/?>/gi, '\n');
  return Papa.unparse(
    { fields: headers.map(unescape), data: rows.map((row) => row.map(unescape)) },
    { delimiter: resolveDelimiter(delimiter) || ',', newline: '\n' },
  );
}

export function changeDelimiter(text, { from = 'auto', to = 'tab' } = {}) {
  const result = Papa.parse(String(text).replace(/\r?\n$/, ''), {
    delimiter: resolveDelimiter(from),
    skipEmptyLines: 'greedy',
  });
  return Papa.unparse(result.data, { delimiter: resolveDelimiter(to) || ',', newline: '\n' });
}

export const looksLikeCsv = (text) => {
  const lines = String(text).trim().split(/\r?\n/);
  if (lines.length < 2) return false;
  const counts = lines.slice(0, 5).map((line) => (line.match(/[,\t;]/g) || []).length);
  return counts[0] > 0 && counts.every((count) => count === counts[0]);
};

// ---------------------------------------------------------------- JSON Lines / JSON5
export function jsonToJsonLines(text) {
  const data = parseJson(text);
  if (!Array.isArray(data)) throw new Error('JSON Lines needs a JSON array at the top level.');
  return data.map((item) => JSON.stringify(item)).join('\n');
}

export function jsonLinesToJson(text, { indent = 2 } = {}) {
  const items = String(text)
    .split(/\r?\n/)
    .map((line, index) => [line.trim(), index])
    .filter(([line]) => line)
    .map(([line, index]) => {
      try {
        return JSON.parse(line);
      } catch (error) {
        throw new Error(`Invalid JSON on line ${index + 1}: ${error.message}`, { cause: error });
      }
    });
  return JSON.stringify(items, null, indent);
}

export function json5ToJson(text, { indent = 2 } = {}) {
  try {
    return JSON.stringify(JSON5.parse(String(text)), null, indent);
  } catch (error) {
    throw new Error(`Invalid JSON5/JSONC: ${error.message.replace(/^JSON5: /, '')}`, { cause: error });
  }
}

// ---------------------------------------------------------------- TOML
export function tomlToJson(text, { indent = 2 } = {}) {
  try {
    return JSON.stringify(
      parseToml(String(text)),
      (_, value) => (typeof value === 'bigint' ? Number(value) : value),
      indent,
    );
  } catch (error) {
    throw new Error(`Invalid TOML: ${error.message.split('\n')[0]}`, { cause: error });
  }
}

export function jsonToToml(text) {
  const data = parseJson(text);
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw new Error('TOML needs a JSON object at the top level.');
  const strip = (value) => {
    if (value === null) throw new Error('TOML has no null value; remove or replace null entries first.');
    if (Array.isArray(value)) return value.map(strip);
    if (typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, strip(v)]));
    return value;
  };
  return stringifyToml(strip(data)).trim();
}

export function formatToml(text) {
  try {
    return stringifyToml(parseToml(String(text))).trim();
  } catch (error) {
    throw new Error(`Invalid TOML: ${error.message.split('\n')[0]}`, { cause: error });
  }
}

export function validateToml(text) {
  try {
    parseToml(String(text));
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      message: `Invalid TOML: ${error.message.split('\n')[0]}`,
      line: error.line,
      column: error.column,
    };
  }
}

// ---------------------------------------------------------------- Query strings / form data
function setNested(target, path, value, arrays) {
  let cursor = target;
  path.forEach((key, index) => {
    const last = index === path.length - 1;
    const nextIsIndex = /^\d*$/.test(path[index + 1] ?? 'x');
    if (key === '') key = Array.isArray(cursor) ? cursor.length : Object.keys(cursor).length;
    if (last) {
      if (Object.prototype.hasOwnProperty.call(cursor, key) && arrays !== 'last') {
        cursor[key] = Array.isArray(cursor[key]) ? [...cursor[key], value] : [cursor[key], value];
      } else {
        cursor[key] = value;
      }
      return;
    }
    if (cursor[key] === undefined || typeof cursor[key] !== 'object') cursor[key] = nextIsIndex ? [] : {};
    cursor = cursor[key];
  });
}

/** Parse a query string or form body. Supports repeated keys, a[]=1, and nested a[b][c]=1 notation. */
export function queryStringToJson(text, { nested = true, repeated = 'array', indent = 2 } = {}) {
  let query = String(text).trim();
  const questionMark = query.indexOf('?');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(query) || questionMark >= 0) query = query.slice(questionMark + 1);
  query = query.replace(/#.*$/, '');
  const result = {};
  for (const pair of query.split('&')) {
    if (!pair) continue;
    const [rawKey, ...rest] = pair.split('=');
    const decode = (value) => {
      try {
        return decodeURIComponent(value.replace(/\+/g, ' '));
      } catch {
        throw new Error(`Invalid percent-encoding in "${value}".`);
      }
    };
    const key = decode(rawKey);
    const value = decode(rest.join('='));
    const path =
      nested && /\[/.test(key)
        ? [key.slice(0, key.indexOf('[')), ...Array.from(key.matchAll(/\[([^\]]*)\]/g), (m) => m[1])]
        : [key];
    setNested(result, path, value, repeated);
  }
  return JSON.stringify(result, null, indent);
}

export function jsonToQueryString(text, { nested = true, arrayStyle = 'repeat' } = {}) {
  const data = parseJson(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Query strings need a JSON object.');
  const pairs = [];
  const encode = (value) => encodeURIComponent(value);
  const walk = (value, key) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => {
        const childKey = arrayStyle === 'brackets' ? `${key}[]` : arrayStyle === 'indices' ? `${key}[${index}]` : key;
        walk(item, childKey);
      });
    } else if (value && typeof value === 'object') {
      if (!nested) {
        pairs.push(`${encode(key)}=${encode(JSON.stringify(value))}`);
        return;
      }
      for (const [childKey, child] of Object.entries(value)) walk(child, `${key}[${childKey}]`);
    } else {
      pairs.push(`${encode(key)}=${encode(value ?? '')}`);
    }
  };
  for (const [key, value] of Object.entries(data)) walk(value, key);
  return pairs.join('&');
}

// ---------------------------------------------------------------- .env and Java properties
export function envToJson(text, { indent = 2 } = {}) {
  const result = {};
  const warnings = [];
  String(text)
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) return;
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)$/.exec(line);
      if (!match) throw new Error(`Invalid .env line ${index + 1}: ${rawLine}`);
      const [, key, rawValue] = match;
      let value = rawValue;
      if (/^"/.test(value)) {
        const end = value.lastIndexOf('"');
        value = value
          .slice(1, end > 0 ? end : undefined)
          .replace(/\\n/g, '\n')
          .replace(/\\"/g, '"')
          .replace(/\\\\/g, '\\');
      } else if (/^'/.test(value)) {
        const end = value.lastIndexOf("'");
        value = value.slice(1, end > 0 ? end : undefined);
      } else {
        value = value.replace(/\s+#.*$/, '').trim();
        if (/\$\{?[A-Za-z_]/.test(value)) warnings.push(`${key}: contains \${…} interpolation that is not expanded`);
      }
      if (Object.prototype.hasOwnProperty.call(result, key)) warnings.push(`${key}: duplicate key, last value kept`);
      result[key] = value;
    });
  return { json: JSON.stringify(result, null, indent), warnings };
}

export function jsonToEnv(text) {
  const data = parseJson(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('.env needs a flat JSON object.');
  return Object.entries(data)
    .map(([key, value]) => {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw new Error(`"${key}" is not a valid environment variable name.`);
      const text = value !== null && typeof value === 'object' ? JSON.stringify(value) : String(value ?? '');
      const needsQuotes = /[\s#"'$\\=]/.test(text) || text === '';
      return `${key}=${needsQuotes ? `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"` : text}`;
    })
    .join('\n');
}

function unescapeProperty(value) {
  return value.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, seq) => {
    if (seq[0] === 'u' && seq.length === 5) return String.fromCharCode(parseInt(seq.slice(1), 16));
    return { t: '\t', n: '\n', r: '\r', f: '\f' }[seq] ?? seq;
  });
}

export function propertiesToJson(text, { indent = 2 } = {}) {
  const logical = [];
  let buffer = '';
  for (const raw of String(text).split(/\r?\n/)) {
    const line = buffer ? raw.trimStart() : raw;
    const trailing = line.match(/\\*$/)[0].length;
    if (trailing % 2 === 1) {
      buffer += line.slice(0, -1);
      continue;
    }
    logical.push(buffer + line);
    buffer = '';
  }
  if (buffer) logical.push(buffer);
  const result = {};
  const warnings = [];
  for (const raw of logical) {
    const line = raw.trimStart();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const match = /^((?:\\.|[^:=\s\\])+)\s*(?:[:=]\s*|\s+|$)([\s\S]*)$/.exec(line);
    if (!match) continue;
    const key = unescapeProperty(match[1]);
    if (Object.prototype.hasOwnProperty.call(result, key)) warnings.push(`${key}: duplicate key, last value kept`);
    result[key] = unescapeProperty(match[2]);
  }
  return { json: JSON.stringify(result, null, indent), warnings };
}

export function jsonToProperties(text) {
  const data = parseJson(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Properties need a JSON object.');
  const flat = flattenForCsv(data);
  const escape = (value, isKey) =>
    String(value)
      .replace(/\\/g, '\\\\')
      .replace(/\n/g, '\\n')
      .replace(/\t/g, '\\t')
      .replace(isKey ? /([:=\s#!])/g : /^(\s)/, '\\$1')
      .replace(/[^\x20-\x7e]/g, (char) => `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`);
  return Object.entries(flat)
    .map(([key, value]) => `${escape(key, true)}=${escape(value ?? '', false)}`)
    .join('\n');
}

// ---------------------------------------------------------------- JSON utilities
export function flattenJson(value, { separator = '.' } = {}) {
  const out = {};
  const walk = (node, prefix) => {
    if (node && typeof node === 'object' && Object.keys(node).length > 0) {
      for (const [key, child] of Object.entries(node))
        walk(child, prefix === null ? key : `${prefix}${separator}${key}`);
    } else {
      out[prefix ?? ''] = node;
    }
  };
  walk(value, null);
  return out;
}

export function unflattenJson(value, { separator = '.' } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Unflatten needs a flat JSON object.');
  const root = {};
  for (const [path, leaf] of Object.entries(value)) {
    const keys = path.split(separator);
    let cursor = root;
    keys.forEach((key, index) => {
      if (index === keys.length - 1) {
        cursor[key] = leaf;
        return;
      }
      if (cursor[key] === undefined) cursor[key] = /^\d+$/.test(keys[index + 1]) ? [] : {};
      cursor = cursor[key];
    });
  }
  return root;
}

/** Minimal JSONPath: $, .key, ['key'], [n], [-n], [*], .*, ..key, [a,b], [start:end]. No script/filter expressions. */
export function jsonPath(data, expression) {
  const path = String(expression).trim();
  if (!path.startsWith('$')) throw new Error('JSONPath must start with $.');
  const tokens = [];
  const pattern =
    /\.\.(\*|[A-Za-z_$][\w$-]*)|\.(\*|[A-Za-z_$][\w$-]*)|\[\s*(\*|-?\d+(?:\s*,\s*-?\d+)*|-?\d*\s*:\s*-?\d*|'(?:[^'\\]|\\.)*'(?:\s*,\s*'(?:[^'\\]|\\.)*')*|"(?:[^"\\]|\\.)*")\s*\]/gy;
  pattern.lastIndex = 1;
  while (pattern.lastIndex < path.length) {
    const start = pattern.lastIndex;
    const match = pattern.exec(path);
    if (!match)
      throw new Error(`Unsupported JSONPath syntax at "${path.slice(start)}". Filters (?()) are not supported.`);
    if (match[1]) tokens.push({ type: 'deep', key: match[1] });
    else if (match[2]) tokens.push({ type: 'key', keys: [match[2]] });
    else {
      const inner = match[3];
      if (inner === '*') tokens.push({ type: 'key', keys: ['*'] });
      else if (inner.includes(':')) {
        const [from, to] = inner.split(':').map((part) => (part.trim() === '' ? undefined : Number(part)));
        tokens.push({ type: 'slice', from, to });
      } else if (/^['"]/.test(inner))
        tokens.push({
          type: 'key',
          keys: inner.match(/'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"/g).map((q) => q.slice(1, -1).replace(/\\(.)/g, '$1')),
        });
      else tokens.push({ type: 'index', indexes: inner.split(',').map(Number) });
    }
  }

  const children = (node) => (node && typeof node === 'object' ? Object.values(node) : []);
  let nodes = [data];
  for (const token of tokens) {
    const next = [];
    for (const node of nodes) {
      if (token.type === 'key') {
        for (const key of token.keys) {
          if (key === '*') next.push(...children(node));
          else if (node && typeof node === 'object' && Object.prototype.hasOwnProperty.call(node, key))
            next.push(node[key]);
        }
      } else if (token.type === 'index' && Array.isArray(node)) {
        for (const index of token.indexes) {
          const resolved = index < 0 ? node.length + index : index;
          if (resolved >= 0 && resolved < node.length) next.push(node[resolved]);
        }
      } else if (token.type === 'slice' && Array.isArray(node)) {
        next.push(...node.slice(token.from, token.to));
      } else if (token.type === 'deep') {
        const visit = (value) => {
          if (!value || typeof value !== 'object') return;
          if (token.key === '*') next.push(...children(value));
          else if (Object.prototype.hasOwnProperty.call(value, token.key)) next.push(value[token.key]);
          children(value).forEach(visit);
        };
        visit(node);
      }
    }
    nodes = next;
  }
  return nodes;
}

function typeName(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

const pascal = (name) =>
  String(name)
    .replace(/(^|[^A-Za-z0-9]+)([A-Za-z0-9])/g, (_, __, char) => char.toUpperCase())
    .replace(/^(\d)/, '_$1') || 'Root';
const safeKey = (key) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : JSON.stringify(key));

/** Generate TypeScript interfaces from a JSON sample. Arrays of objects are merged; missing keys become optional. */
export function jsonToTypeScript(value, { rootName = 'Root' } = {}) {
  const interfaces = new Map();
  const typeOf = (node, nameHint) => {
    if (node === null) return 'null';
    if (Array.isArray(node)) {
      if (node.length === 0) return 'unknown[]';
      if (node.every((item) => item && typeof item === 'object' && !Array.isArray(item)))
        return `${objectType(node, singular(nameHint))}[]`;
      const types = Array.from(new Set(node.map((item) => typeOf(item, singular(nameHint)))));
      return types.length === 1 ? `${types[0]}[]` : `(${types.join(' | ')})[]`;
    }
    if (typeof node === 'object') return objectType([node], nameHint);
    return typeof node;
  };
  const singular = (name) => String(name).replace(/ies$/, 'y').replace(/s$/, '');
  const objectType = (samples, nameHint) => {
    let name = pascal(nameHint);
    while (interfaces.has(name) && interfaces.get(name).samples !== samples) name += '_';
    const keys = Array.from(new Set(samples.flatMap((sample) => Object.keys(sample))));
    const fields = keys.map((key) => {
      const present = samples.filter((sample) => Object.prototype.hasOwnProperty.call(sample, key));
      const types = Array.from(new Set(present.map((sample) => typeOf(sample[key], key))));
      const optional = present.length < samples.length ? '?' : '';
      return `  ${safeKey(key)}${optional}: ${types.join(' | ')};`;
    });
    interfaces.set(name, { samples, body: `export interface ${name} {\n${fields.join('\n')}\n}` });
    return name;
  };
  const rootType = typeOf(value, rootName);
  const bodies = Array.from(interfaces.values())
    .map((entry) => entry.body)
    .reverse();
  if (!interfaces.has(pascal(rootName))) bodies.push(`export type ${pascal(rootName)} = ${rootType};`);
  return bodies.join('\n\n');
}

/** Infer a draft-2020-12 JSON Schema sketch from a sample. */
export function jsonToSchema(value) {
  const infer = (node) => {
    const type = typeName(node);
    if (type === 'array') {
      if (node.length === 0) return { type: 'array', items: {} };
      const itemSchemas = node.map(infer);
      if (node.every((item) => typeName(item) === 'object')) {
        const keys = Array.from(new Set(node.flatMap((item) => Object.keys(item))));
        const properties = Object.fromEntries(keys.map((key) => [key, infer(node.find((item) => key in item)[key])]));
        const required = keys.filter((key) => node.every((item) => key in item));
        return { type: 'array', items: { type: 'object', properties, ...(required.length ? { required } : {}) } };
      }
      const types = Array.from(new Set(itemSchemas.map((schema) => schema.type)));
      return { type: 'array', items: types.length === 1 ? itemSchemas[0] : { type: types } };
    }
    if (type === 'object') {
      const keys = Object.keys(node);
      return {
        type: 'object',
        properties: Object.fromEntries(keys.map((key) => [key, infer(node[key])])),
        ...(keys.length ? { required: keys } : {}),
      };
    }
    return { type };
  };
  return { $schema: 'https://json-schema.org/draft/2020-12/schema', ...infer(value) };
}
