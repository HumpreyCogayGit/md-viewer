import { defineOperation } from './registry.js';

/** Create an operation factory with category-wide defaults (text in, text out, replace mode). */
export function operationFactory(category, defaults = {}) {
  return (definition) =>
    defineOperation({
      category,
      inputType: 'text',
      outputType: 'text',
      ...defaults,
      ...definition,
    });
}

/** Split input into two parts on a separator line (used by two-input operations such as set operations or diff). */
export function splitTwoInputs(input, separator = '---') {
  const lines = String(input).split(/\r?\n/);
  const index = lines.findIndex((line) => line.trim() === separator);
  if (index === -1) {
    throw new Error(`Put a line containing only "${separator}" between the two inputs.`);
  }
  return [lines.slice(0, index).join('\n'), lines.slice(index + 1).join('\n')];
}

export function splitLines(input) {
  const text = String(input);
  if (text === '') return [];
  return text.split(/\r?\n/);
}

export function detectLineEnding(input) {
  return /\r\n/.test(input) ? '\r\n' : '\n';
}

export function markdownTable(headers, rows) {
  const escape = (value) =>
    String(value ?? '')
      .replace(/\|/g, '\\|')
      .replace(/\r?\n/g, '<br>');
  const head = `| ${headers.map(escape).join(' | ')} |`;
  const divider = `| ${headers.map(() => '---').join(' | ')} |`;
  const body = rows.map((row) => `| ${row.map(escape).join(' | ')} |`);
  return [head, divider, ...body].join('\n');
}

export function markdownList(items) {
  return items.map((item) => `- ${item}`).join('\n');
}
