// Markdown (GFM) table parsing, formatting and manipulation.

/** Approximate monospace display width: wide East Asian characters and emoji count as 2. */
export function displayWidth(text) {
  let width = 0;
  for (const char of String(text)) {
    const code = char.codePointAt(0);
    if (/\p{Mn}|\p{Me}|‍|️/u.test(char)) continue;
    const wide =
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe4f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x1f300 && code <= 0x1faff) ||
      (code >= 0x2600 && code <= 0x27bf && /\p{Extended_Pictographic}/u.test(char)) ||
      (code >= 0x20000 && code <= 0x3fffd);
    width += wide ? 2 : 1;
  }
  return width;
}

/** Split one table row into cells, honouring escaped pipes and pipes inside inline code. */
export function splitRow(line) {
  let text = line.trim();
  if (text.startsWith('|')) text = text.slice(1);
  if (text.endsWith('|') && !text.endsWith('\\|')) text = text.slice(0, -1);
  const cells = [];
  let current = '';
  let inCode = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '\\' && text[i + 1] === '|') {
      current += '\\|';
      i += 1;
      continue;
    }
    if (char === '`') {
      let run = 1;
      while (text[i + run] === '`') run += 1;
      if (inCode === 0) inCode = run;
      else if (inCode === run) inCode = 0;
      current += '`'.repeat(run);
      i += run - 1;
      continue;
    }
    if (char === '|' && inCode === 0) {
      cells.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

const DELIMITER_CELL = /^:?-{1,}:?$/;

export function isTableDelimiterRow(line) {
  const cells = splitRow(line);
  return line.includes('-') && cells.length > 0 && cells.every((cell) => DELIMITER_CELL.test(cell.replace(/\s/g, '')));
}

function alignmentOf(cell) {
  const clean = cell.replace(/\s/g, '');
  if (clean.startsWith(':') && clean.endsWith(':')) return 'center';
  if (clean.endsWith(':')) return 'right';
  if (clean.startsWith(':')) return 'left';
  return 'none';
}

/** Parse a Markdown table. Returns { headers, align, rows }. */
export function parseMarkdownTable(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2 || !isTableDelimiterRow(lines[1]) || !lines[0].includes('|')) {
    throw new Error('Not a Markdown table: expected a header row followed by a |---| delimiter row.');
  }
  const headers = splitRow(lines[0]);
  const align = splitRow(lines[1]).map(alignmentOf);
  const width = headers.length;
  const normalize = (cells) => Array.from({ length: width }, (_, i) => cells[i] ?? '');
  while (align.length < width) align.push('none');
  return { headers, align: align.slice(0, width), rows: lines.slice(2).map((line) => normalize(splitRow(line))) };
}

export function isMarkdownTable(text) {
  try {
    parseMarkdownTable(text);
    return true;
  } catch {
    return false;
  }
}

const escapeCell = (value) =>
  String(value ?? '')
    .replace(/\r?\n/g, '<br>')
    .replace(/(?<!\\)\|/g, '\\|');

/** Render a table with aligned columns (pretty) or minimal spacing (compact). */
export function renderMarkdownTable({ headers, align = [], rows }, { pretty = true } = {}) {
  const head = headers.map(escapeCell);
  const body = rows.map((row) => headers.map((_, i) => escapeCell(row[i])));
  const alignment = headers.map((_, i) => align[i] || 'none');
  if (!pretty) {
    const delimiter = alignment.map((a) => ({ left: ':---', right: '---:', center: ':---:', none: '---' })[a]);
    return [head, delimiter, ...body].map((cells) => `| ${cells.join(' | ')} |`).join('\n');
  }
  const widths = head.map((cell, i) => Math.max(3, displayWidth(cell), ...body.map((row) => displayWidth(row[i]))));
  const padCell = (cell, i) => {
    const gap = widths[i] - displayWidth(cell);
    if (alignment[i] === 'right') return ' '.repeat(gap) + cell;
    if (alignment[i] === 'center') return ' '.repeat(Math.floor(gap / 2)) + cell + ' '.repeat(Math.ceil(gap / 2));
    return cell + ' '.repeat(gap);
  };
  const delimiter = widths.map((width, i) => {
    const a = alignment[i];
    if (a === 'center') return `:${'-'.repeat(width - 2)}:`;
    if (a === 'right') return `${'-'.repeat(width - 1)}:`;
    if (a === 'left') return `:${'-'.repeat(width - 1)}`;
    return '-'.repeat(width);
  });
  const line = (cells) => `| ${cells.join(' | ')} |`;
  return [line(head.map(padCell)), line(delimiter), ...body.map((row) => line(row.map(padCell)))].join('\n');
}

export const formatMarkdownTable = (text, options) => renderMarkdownTable(parseMarkdownTable(text), options);

/** Format every table found in a Markdown document (outside fenced code). */
export function formatAllTables(markdown, options) {
  const lines = String(markdown).split('\n');
  const output = [];
  let inFence = null;
  for (let i = 0; i < lines.length; i += 1) {
    const fence = /^\s*(`{3,}|~{3,})/.exec(lines[i]);
    if (fence) {
      if (!inFence) inFence = fence[1][0];
      else if (fence[1][0] === inFence) inFence = null;
      output.push(lines[i]);
      continue;
    }
    if (!inFence && lines[i].includes('|') && lines[i + 1] && isTableDelimiterRow(lines[i + 1])) {
      let end = i + 2;
      while (end < lines.length && lines[end].includes('|') && lines[end].trim()) end += 1;
      const indent = lines[i].match(/^\s*/)[0];
      output.push(
        ...formatMarkdownTable(lines.slice(i, end).join('\n'), options)
          .split('\n')
          .map((line) => indent + line),
      );
      i = end - 1;
      continue;
    }
    output.push(lines[i]);
  }
  return output.join('\n');
}

// ---------------------------------------------------------------- Table manipulation
const tableOp = (fn) => (text, options) => {
  const table = parseMarkdownTable(text);
  return renderMarkdownTable(fn(table, options));
};

const columnIndex = (table, column) => {
  const asNumber = Number(column);
  if (Number.isInteger(asNumber) && asNumber >= 1 && asNumber <= table.headers.length) return asNumber - 1;
  const byName = table.headers.findIndex((header) => header.toLowerCase() === String(column).trim().toLowerCase());
  if (byName === -1) throw new Error(`Column "${column}" not found. Use a 1-based number or a header name.`);
  return byName;
};

export const sortTable = tableOp((table, { column = 1, order = 'asc', numeric = true } = {}) => {
  const index = columnIndex(table, column);
  const collator = new Intl.Collator(undefined, { numeric, sensitivity: 'base' });
  const rows = [...table.rows].sort((a, b) => collator.compare(a[index], b[index]));
  return { ...table, rows: order === 'desc' ? rows.reverse() : rows };
});

export const transposeTable = tableOp((table) => {
  const matrix = [table.headers, ...table.rows];
  const headers = matrix.map((row) => row[0]);
  const rows = table.headers.slice(1).map((_, c) => matrix.map((row) => row[c + 1]));
  return { headers, align: headers.map(() => 'none'), rows };
});

export const addColumn = tableOp((table, { name = 'New', position = 0 } = {}) => {
  const index = position >= 1 ? Math.min(position - 1, table.headers.length) : table.headers.length;
  const insert = (list, value) => [...list.slice(0, index), value, ...list.slice(index)];
  return {
    headers: insert(table.headers, name),
    align: insert(table.align, 'none'),
    rows: table.rows.map((row) => insert(row, '')),
  };
});

export const removeColumn = tableOp((table, { column = 1 } = {}) => {
  const index = columnIndex(table, column);
  if (table.headers.length === 1) throw new Error('Cannot remove the only column.');
  const drop = (list) => list.filter((_, i) => i !== index);
  return { headers: drop(table.headers), align: drop(table.align), rows: table.rows.map(drop) };
});

export const moveColumn = tableOp((table, { column = 1, to = 1 } = {}) => {
  const from = columnIndex(table, column);
  const target = Math.max(0, Math.min(table.headers.length - 1, Number(to) - 1));
  const move = (list) => {
    const copy = [...list];
    const [item] = copy.splice(from, 1);
    copy.splice(target, 0, item);
    return copy;
  };
  return { headers: move(table.headers), align: move(table.align), rows: table.rows.map(move) };
});

export const alignTable = tableOp((table, { column = 'all', align = 'left' } = {}) => ({
  ...table,
  align: table.align.map((current, i) => (column === 'all' || columnIndex(table, column) === i ? align : current)),
}));
